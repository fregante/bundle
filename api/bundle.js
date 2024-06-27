import {resolve} from 'node:path';
import process from 'node:process';
import {execa} from 'execa';
import {rollup} from 'rollup';
import {sync} from 'tempdir';
import rollupResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import cleanup from 'rollup-plugin-cleanup';
import camelcase from 'camelcase';
import memoize from 'memoize';

const cwd = sync();
const home = sync();

async function run(name, arguments_) {
	console.log('💻 Running', name, ...arguments_);
	const running = execa(name, arguments_, {
		cwd,
		env: {
			HOME: home,
		},
	});

	running.stdout.pipe(process.stdout);
	running.stderr.pipe(process.stderr);
	return running;
}

class UnprocessableError extends Error {
	constructor(message) {
		super(message);
		this.statusCode = 422;
	}
}

/**
 * @param {import('@vercel/node').VercelRequest} request
 * @param {import('@vercel/node').VercelResponse} response
 */
export default async function handle(request, response) {
	try {
		console.log('✅ Processing', request.query.pkg);
		const {version, code} = await bundle(
			request.query.pkg,
			request.query.global ?? request.query.name,
		);
		response.setHeader('x-bundle-version', version);
		response.send(code);
		console.log('✅ Bundled', request.query.pkg);
	} catch (error) {
		console.error('❌', error);
		response.status(error.statusCode ?? 500);
		response.send(error.message);
	}
}

const bundle = memoize(async (nameRequest, globalName) => {
	if (/[^a-z\d@/-]/i.test(nameRequest)) {
		throw new UnprocessableError('Invalid package name');
	}

	console.log('⏳ Getting info about', nameRequest);
	const infoProcess = await run('npm', ['view', nameRequest, '--json']);
	const package_ = JSON.parse(infoProcess.stdout);
	const isFregante = package_.maintainers.some(
		user => ['fregante', 'bfred-it'].includes(user.split(' ')[0]),
	);
	if (!isFregante) {
		throw new UnprocessableError('Only fregante packages allowed');
	}

	console.log('⏳ Installing', nameRequest);
	await run('npm', [
		'install',
		nameRequest,
		'--omit=dev',
		'--ignore-scripts',
		'--no-audit',
		'--no-bin-links',
	]);

	const packagePath = resolve(cwd, 'node_modules', package_.name);
	return {
		version: package_.version,
		code: await bundleWithRollup(
			packagePath,
			globalName ?? camelcase(package_.name),
		),
	};
}, {
	cacheKey: JSON.stringify,
});

console.clear();
console.log('✅ Node server running');

async function bundleWithRollup(input, name) {
	const bundle = await rollup({
		input,
		plugins: [
			rollupResolve({exportConditions: ['node']}),
			commonjs(),
			cleanup(),
		],
	});

	const result = await bundle.generate({
		format: 'iife',
		extend: name === 'window',
		name,
	});

	if (result.output.length > 1) {
		throw new Error('Incompatible library');
	}

	return result.output[0].code;
}
