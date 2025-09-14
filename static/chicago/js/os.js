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

function generate_uuid() {
	if (crypto?.randomUUID)
		return crypto.randomUUID();

	return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
		(c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
	);
}
// endregion

// region c_ui_button
const c_ui_button = {
	props: {
		label: { type: String, default: 'OK' }
	},

	template: `<input class="c-ui-button c-ui-raised" type="button" :value="label"/>`
};
// endregion

// region c_ui_window
let global_is_first_window = true;
let global_win_sub_x = 45;
let global_win_sub_y = 45;

const c_ui_window = {
	props: {
		width: { type: Number, default: 200 },
		height: { type: Number, default: 150 },
		title: { type: String, default: 'New Window' }
	},

	data() {
		return {
			pos_x: 0,
			pos_y: 0,
			is_dragging: false,
			drag_offset_x: 0,
			drag_offset_y: 0
		}
	},

	mounted() {
		if (global_is_first_window) {
			this.pos_x = global_win_sub_x;
			this.pos_y = global_win_sub_y;
			global_is_first_window = false;
		} else {
			let x = global_win_sub_x + 24;
			let y = global_win_sub_y + 24;
	
			if ((x + this.width) > window.visualViewport.width || (y + this.height) > window.visualViewport.height) {
				x = 0;
				y = 0;
			}
	
			// 8-pixel quantization
			x = (x / 8) * 8;
			y = (y / 8) * 8;
	
			this.pos_x = global_win_sub_x = x;
			this.pos_y = global_win_sub_y = y;
		}
	},

	methods: {
		mouse_down(event) {
			this.is_dragging = true;
			this.drag_offset_x = event.clientX - this.pos_x;
			this.drag_offset_y = event.clientY - this.pos_y;

			const mouse_move = (e) => {
				if (this.is_dragging) {
					this.pos_x = e.clientX - this.drag_offset_x;
					this.pos_y = e.clientY - this.drag_offset_y;
				}
			};

			const mouse_up = () => {
				this.is_dragging = false;
				document.removeEventListener('mousemove', mouse_move);
				document.removeEventListener('mouseup', mouse_up);
			};

			document.addEventListener('mousemove', mouse_move);
			document.addEventListener('mouseup', mouse_up);
			event.preventDefault();
		},

		touch_start(event) {
			const touch = event.touches[0];
			this.is_dragging = true;
			this.drag_offset_x = touch.clientX - this.pos_x;
			this.drag_offset_y = touch.clientY - this.pos_y;

			const touch_move = (e) => {
				if (this.is_dragging) {
					const touch = e.touches[0];
					this.pos_x = touch.clientX - this.drag_offset_x;
					this.pos_y = touch.clientY - this.drag_offset_y;
				}
			};

			const touch_end = () => {
				this.is_dragging = false;
				document.removeEventListener('touchmove', touch_move);
				document.removeEventListener('touchend', touch_end);
			};

			document.addEventListener('touchmove', touch_move);
			document.addEventListener('touchend', touch_end);
			event.preventDefault();
		}
	},

	template: `
		<div
			class="c-ui-window c-ui-raised"
			:style="{ top: pos_y + 'px', left: pos_x + 'px', width: width + 'px', height: height + 'px' }">
			<div class="titlebar" @mousedown="mouse_down" @touchstart="touch_start">
				<span class="title">{{ title }}</span>
			</div>
			<slot></slot>
		</div>
	`
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
const global_module_meta = new Map();
const global_module_fonts = new Set();

async function load_module(module_path) {
	try {
		const module_id = generate_uuid();
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
					case 'otf':
					case 'woff':
					case 'woff2':
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
		const font_params = font_name.includes('bold') ? { weight: 'bold' } : undefined;

		console.log(`preloading font from css ${font_name}`);
		css_preload.push(load_font(font_name, `/static/chicago/fonts/${font_name}.woff2`, font_params));
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

async function load_font(font_name, href, params) {
	if (global_module_fonts.has(font_name)) {
		console.log(`font ${font_name} already loaded, skipping`);
		return;
	}

	console.log(`load_font ${font_name} ${href}`);

	const font = new FontFace(font_name, `url(${href})`, params);
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
	app.component('c-ui-window', c_ui_window);

	await load_stylesheet('{{asset=css/global.css}}');

	app.mount('body');

	const test = await load_module('{{asset=js/modules/mod_test.js}}');
})();
// endregion