const execa = require('execa');
const path = require('path');
const rollup = require('rollup');
const tempdir = require('tempdir');
const resolve = require('rollup-plugin-node-resolve');
const commonjs = require('rollup-plugin-commonjs');
const cleanup = require('rollup-plugin-cleanup');
const camelcase = require('camelcase');
const mem = require('mem');

const cwd = tempdir.sync();
const home = tempdir.sync();

async function run(name, args) {
	console.log('💻 Running', name, ...args);
	const running = execa(name, args, {
		cwd,
		env: {
			HOME: home
		}
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
module.exports = async (request, response) => {
	try {
		console.log('✅ Processing', request.query.pkg);
		const {version, code} = await bundle(
			request.query.pkg,
			request.query.global ?? request.query.name
		);
		response.setHeader('x-bundle-version', version);
		response.send(code);
		console.log('✅ Bundled', request.query.pkg);
	} catch (error) {
		console.error('❌', error);
		response.status(error.statusCode ?? 500);
		response.send(error.message);
	}
};

const bundle = mem(async (nameRequest, globalName) => {
	if (/[^a-z\d@/-]/i.test(nameRequest)) {
		throw new UnprocessableError('Invalid package name');
	}

	console.log('⏳ Getting info about', nameRequest);
	const infoProcess = await run('npm', ['view', nameRequest, '--json']);
	const pkg = JSON.parse(infoProcess.stdout);
	const isFregante = pkg.maintainers.some(
		user => ['fregante', 'bfred-it'].includes(user.split(' ')[0])
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
		'--no-bin-links'
	]);

	const packagePath = path.resolve(cwd, 'node_modules', pkg.name);
	return {
		version: pkg.version,
		code: await bundleWithRollup(
			packagePath,
			globalName ?? camelcase(pkg.name)
		)
	};
}, {
	cacheKey: JSON.stringify
});

console.clear();
console.log('✅ Node server running');

async function bundleWithRollup(input, name) {
	const bundle = await rollup.rollup({
		input,
		plugins: [
			resolve({browser: true}),
			commonjs(),
			cleanup()
		]
	});

	const result = await bundle.generate({
		format: 'iife',
		extend: name === 'window',
		name
	});

	if (result.output.length > 1) {
		throw new Error('Incompatible library');
	}

	return result.output[0].code;
}
