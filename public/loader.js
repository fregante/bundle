const status = document.querySelector('#status');

async function init() {
	const url = new URL(location.href);
	const pkg = url.searchParams.get('pkg');
	if (!pkg) {
		return;
	}

	document.querySelector('[name="pkg"]').value = pkg;
	status.textContent = 'Bundling…';

	url.pathname = '/api/bundle';
	const response = await fetch(url);
	const output = await response.json();

	if (!response.ok) {
		throw new Error(output.error);
	}

	const filename = pkg + '.' + output.version + '.js';
	status.textContent = 'Bundle ready!';
	status.insertAdjacentHTML('afterend', `
		<p>
			Download:
			<a download="${filename}">
				<code>${filename}</code>
			</a>
		</p>
		<textarea>${output.bundle}</textarea>
	`);

	const blob = new Blob([output.bundle], {
		type: 'application/javascript'
	});
	document.querySelector('a[download]').href = URL.createObjectURL(blob);

	const {default: fitTextarea} = await import('https://unpkg.com/fit-textarea@latest/index.js');
	fitTextarea.watch('textarea');
}

init().catch(error => {
	console.error(error);
	status.textContent = 'Got an error';
	status.insertAdjacentHTML('afterend', `
		<pre>${error.message}</pre>
	`);
});
