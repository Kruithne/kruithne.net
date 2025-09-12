import { createApp, reactive } from '{{asset=js/lib/vue.esm.prod.js}}';

// region generic
const EMPTY_ARRAY = new Array(0);

function path_basename(path) {
	return path.match(/(?:^|\/)([^/?#]+)(?:[?#].*)?$/)?.[1] ?? '';
}

function ext_split(file) {
	const idx = file.lastIndexOf('.');
	if (idx === -1)
		return [file, ''];

	return [file.slice(0, idx), file.slice(idx + 1)];
}
// endregion

// region c_ui_button
const c_ui_button = {
	props: {
		label: {
			type: String,
			default: 'OK'
		}
	},

	template: `<input type="button" :value="label"/>`
};
// endregion

// region sys_state
const sys_state = reactive({
	modules: []
});
// endregion

// region sys_registry
const sys_registry = reactive({
	key: 'test_value'
});
// endregion

// region modules
const PRELOAD_TYPE_STYLESHEET = 0x1;

const global_module_meta = new Map();
const global_module_fonts = new Set();

async function load_module(module_path) {
	try {
		const module_id = crypto.randomUUID();
		console.log(`load_module ${module_path} ${module_id}`);

		const mod = (await import(module_path)).default;
		const preloads = [];

		if (mod.preload) {
			const tracked_css = [];

			for (const href of mod.preload) {
				const href_basename = path_basename(href); // OCRAEXT.TTF
				const [href_base, href_ext] = ext_split(href_basename); // [OCRAEXT, TTF]

				const ext_lower = href_ext.toLowerCase();

				switch (ext_lower) {
					case 'ttf':
						preloads.push(load_font(href_base, href));
						break;

					case 'css':
						tracked_css.push(href);
						preloads.push(load_stylesheet(href));
						break;

					case 'webp':
						preloads.push(preload_image(href));
						break;

					default:
						console.error(`load_module unsupported ${ext_lower} preload ${href}`);
				}
			}

			global_module_meta.set(module_id, tracked_css);
		}

		if (mod.component.template) {
			const image_matches = [...mod.component.template.matchAll(/"([^"]*\.webp[^"]*)"/gi)];
			for (const match of image_matches) {
				console.log(`preloading template image ${match[1]}`);
				preloads.push(preload_image(match[1]));
			}
		}

		await Promise.all(preloads);

		sys_state.modules.push({
			id: module_id,
			component: mod.component,
			props: { module_id }
		});
		
		return module_id;
	} catch (e) {
		console.error('failed to load module %s', module_path);
		console.error(e);
	}
}

function unload_module(module_id) {
	console.log(`unload_module ${module_id}`);

	const mod_idx = sys_state.modules.findIndex(m => m.id === module_id);
	if (mod_idx !== -1)
		sys_state.modules.splice(mod_idx, 1);

	for (const href of global_module_meta.get(module_id) ?? EMPTY_ARRAY)
		unload_stylesheet(href);

	global_module_meta.delete(module_id);
}

async function preload_image(src) {
	console.log(`load_image ${src}`);
	return new Promise(resolve => {
		const img = new Image();
		img.onload = () => resolve();
		img.onerror = () => {
			console.error(`preload_image failed ${src}`);
			resolve();	
		};
		img.src = src;
	});
}

async function load_stylesheet(href) {
	console.log(`load_stylesheet ${href}`);
	const existing = document.querySelector(`style[data-href="${href}"]`);

	if (existing !== null) {
		existing.setAttribute('data-users', Number(existing.getAttribute('data-users')) + 1);
		return;
	}

	const style = document.createElement('style');
	style.setAttribute('data-href', href);
	style.setAttribute('data-users', 1);

	const res = await fetch(href);
	const css = await res.text();
	style.textContent = css;

	const css_preload = [];

	// extract preload images directly from CSS
	const img_matches = [...css.matchAll(/url\s*\(\s*(?:['"]([^'"]+)['"]|([^)]+))\s*\)/gi)];
	for (const match of img_matches) {
		const url = match[1] || match[2];
		if (url?.trim()) {
			console.log(`preloading image from css ${url}`);
			css_preload.push(preload_image(url));
		}
	}

	// extract referenced fonts directly from CSS
	const font_matches = [...css.matchAll(/font-family\s*:\s*([^;]+)/gi)];
	for (const match of font_matches) {
		const font_name = match[1].trim();
		console.log(`preloading font from css ${font_name}`);
		css_preload.push(load_font(font_name, `/static/chicago/fonts/${font_name}.ttf`));
	}

	await Promise.all(css_preload);
	document.head.appendChild(style);
}

function unload_stylesheet(href) {
	console.log(`unload_stylesheet ${href}`);
	const style = document.querySelector(`style[data-href="${href}"]`);
	if (style !== null) {
		const new_link_users = Number(style.getAttribute('data-users')) - 1;
		if (new_link_users < 1)
			style.remove();
		else
			style.setAttribute('data-users', new_link_users);
	}
}

async function load_font(font_name, href) {
	if (global_module_fonts.has(font_name)) {
		console.log(`font ${font_name} already loaded, skipping`);
		return;
	}

	console.log(`load_font ${font_name} ${href}`);

	const font = new FontFace(font_name, `url(${href})`);
	await font.load();

	document.fonts.add(font);
	global_module_fonts.add(font_name);
}
// endregion

// region bootstrap
(async () => {
	const app = createApp({
		data() {
			return sys_state;
		},

		template: `<component v-for="mod in modules" :key="mod.id" :is="mod.component" v-bind="mod.props"/>`
	});
	
	// register stores
	app.provide('sys_registry', sys_registry);
	
	// register components
	app.component('c-ui-button', c_ui_button);

	app.mount('body');

	const test = await load_module('{{asset=js/modules/mod_test.js}}');
})();
// endregion