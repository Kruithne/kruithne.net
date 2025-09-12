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
const PRELOAD_TYPE_FONT = 0x2;

const global_module_meta = new Map();
const global_module_fonts = new Map();

async function load_module(module_path) {
	try {
		const module_id = crypto.randomUUID();
		console.log(`load_module ${module_path} ${module_id}`);

		const mod = (await import(module_path)).default;

		if (mod.preload) {
			const preloads = [];

			for (const href of mod.preload) {
				const href_basename = path_basename(href); // OCRAEXT.TTF
				const [href_base, href_ext] = ext_split(href_basename); // [OCRAEXT, TTF]

				const ext_lower = href_ext.toLowerCase();

				switch (ext_lower) {
					case 'ttf':
						preloads.push(load_font(href_base, href));
						break;

					case 'css':
						preloads.push(load_stylesheet(href));
						break;

					case 'webp':
						preload_image(href);
						break;

					default:
						console.error(`load_module unsupported ${ext_lower} preload ${href}`);
				}
			}

			global_module_meta.set(module_id, await Promise.all(preloads));
		}

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

	for (const meta of global_module_meta.get(module_id) ?? EMPTY_ARRAY) {
		switch (meta.type) {
			case PRELOAD_TYPE_STYLESHEET:
				unload_stylesheet(meta.href);
				break;

			case PRELOAD_TYPE_FONT:
				unload_font(meta.font_name);
				break;

			default:
				console.error(`unload_module unsupported preload type ${meta.type}`);
		}
	}

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
	return new Promise((resolve, reject) => {
		const meta = { type: PRELOAD_TYPE_STYLESHEET, href };
		const existing = document.querySelector(`link[href="${href}"]`);

		if (existing !== null) {
			existing.setAttribute('data-users', Number(existing.getAttribute('data-users')) + 1);
			return resolve(meta);
		}

		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = href;
		link.setAttribute('data-users', 1);

		link.onload = () => resolve(meta);
		link.onerror = () => reject(new Error('stylesheet failure'));
		
		document.head.appendChild(link);
	});
}

function unload_stylesheet(href) {
	console.log(`unload_stylesheet ${href}`);
	const link = document.querySelector(`link[href="${href}"]`);
	if (link !== null) {
		const new_link_users = Number(link.getAttribute('data-users')) - 1;
		if (new_link_users < 1)
			link.remove();
		else
			link.setAttribute('data-users', new_link_users);
	}
}

async function load_font(font_name, href) {
	console.log(`load_font ${font_name} ${href}`);
	const existing = global_module_fonts.get(font_name);
	if (existing) {
		existing.users += 1;
		console.log(`font ${font_name} now has ${existing.users} users`);
		return { type: PRELOAD_TYPE_FONT, font_name };
	}

	const font = new FontFace(font_name, `url(${href})`);
	await font.load();

	document.fonts.add(font);

	global_module_fonts.set(font_name, { font, users: 1 });
	return { type: PRELOAD_TYPE_FONT, font_name };
}

function unload_font(font_name) {
	console.log(`unload_font ${font_name}`);
	const entry = global_module_fonts.get(font_name);
	if (entry) {
		entry.users -= 1;
		console.log(`font ${font_name} now has ${entry.users} users`);

		if (entry.users < 1) {
			console.log(`unregistering font ${font_name}`);
			document.fonts.delete(entry.font);
			global_module_fonts.delete(font_name);
		}
	}
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
	//setTimeout(() => unload_module(test), 3000);
})();
// endregion