import { createApp, reactive } from '{{asset=js/lib/vue.esm.prod.js}}';
import { c_app_base } from '{{asset=js/components/c_app_base.js}}';

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
		label: { type: String, default: 'OK' }
	},

	template: `<input class="c-ui-button c-ui-raised" type="button" :value="label"/>`
};
// endregion

// region c_pixel_font
const c_pixel_font = {
	props: {
		text: { type: String, default: '' },
		font: { type: String, required: true },
		color: { type: String, default: '#ffffff' },
		bold: { type: Boolean, default: false }
	},

	data() {
		return {
			canvas_width: 0,
			canvas_height: 0
		}
	},

	async mounted() {
		await this.$nextTick();
		this.render_text();
	},

	watch: {
		text() {
			this.render_text();
		},
		color() {
			this.render_text();
		},
		bold() {
			this.render_text();
		}
	},

	methods: {
		async render_text() {
			const pixel_font = global_pixel_fonts.get(this.font);
			if (!pixel_font) {
				console.error(`pixel font ${this.font} not loaded`);
				return;
			}

			const { metadata, image } = pixel_font;
			const canvas = this.$refs.canvas;
			if (!canvas)
				return;

			let total_width = 0;
			const text_chars = Array.from(this.text);
			const bold_char_spacing = this.bold ? 1 : 0;

			for (const char of text_chars) {
				const char_data = metadata.characters[char];
				if (char_data) {
					total_width += char_data.width + bold_char_spacing;
				}
			}

			const bold_offset = this.bold ? 1 : 0;
			const canvas_width = total_width + bold_offset;

			this.canvas_width = canvas_width;
			this.canvas_height = metadata.pixel_height;

			await this.$nextTick();

			const ctx = canvas.getContext('2d');
			ctx.clearRect(0, 0, canvas_width, metadata.pixel_height);

			let x_offset = 0;
			for (const char of text_chars) {
				const char_data = metadata.characters[char];
				if (char_data) {
					ctx.drawImage(
						image,
						char_data.x, char_data.y, char_data.width, char_data.height,
						x_offset, 0, char_data.width, char_data.height
					);

					if (this.bold) {
						ctx.drawImage(
							image,
							char_data.x, char_data.y, char_data.width, char_data.height,
							x_offset + 1, 0, char_data.width, char_data.height
						);
					}

					x_offset += char_data.width + bold_char_spacing;
				}
			}

			if (this.color !== '#ffffff') {
				ctx.globalCompositeOperation = 'source-in';
				ctx.fillStyle = this.color;
				ctx.fillRect(0, 0, canvas_width, metadata.pixel_height);
				ctx.globalCompositeOperation = 'source-over';
			}
		}
	},

	template: `<canvas ref="canvas" :width="canvas_width" :height="canvas_height" style="display: inline-block; vertical-align: middle;"></canvas>`
};
// endregion

// region c_ui_window
let global_is_first_window = true;
let global_win_sub_x = 45;
let global_win_sub_y = 45;

const c_ui_window = {
	inject: ['sys_state'],

	props: {
		width: { type: Number, default: 200 },
		height: { type: Number, default: 150 },
		title: { type: String, default: 'New Window' },
		module: { type: Object, required: false },
		win_idx: { type: Number, default: 0 }
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
		win_pointerdown_capture(event) {
			if (this.module)
				this.sys_state.mod_activate(this.module);
		},

		tb_pointerdown_capture(event) {
			if (!this.is_active_win)
				return;

			this.is_dragging = true;
			this.drag_offset_x = event.clientX - this.pos_x;
			this.drag_offset_y = event.clientY - this.pos_y;

			const pointermove = (e) => {
				if (this.is_dragging) {
					this.pos_x = e.clientX - this.drag_offset_x;
					this.pos_y = e.clientY - this.drag_offset_y;
				}
			};

			const pointerup = () => {
				this.is_dragging = false;
				document.removeEventListener('pointermove', pointermove);
				document.removeEventListener('pointerup', pointerup);
			};

			document.addEventListener('pointermove', pointermove);
			document.addEventListener('pointerup', pointerup);
			event.preventDefault();
		}
	},

	computed: {
		is_active_win() {
			return this.module && this.sys_state.active_module === this.module && this.win_idx === 0;
		},

		title_color() {
			return this.is_active_win ? '#ffffff' : '#c0c0c0';
		}
	},

	template: `
		<div
			class="c-ui-window c-ui-raised"
			:class="{ active: is_active_win }"
			:style="{ top: pos_y + 'px', left: pos_x + 'px', width: width + 'px', height: height + 'px' }"
			@pointerdown.capture="win_pointerdown_capture"
		>
			<div class="titlebar" @pointerdown="tb_pointerdown_capture">
				<c-pixel-text :text="title" font="sserife-8pt" :color="title_color" :bold="true" class="title"/>
			</div>
			<slot></slot>
		</div>
	`
};
// endregion


// region sys_state
const sys_state = reactive({
	modules: [],

	mod_activate(mod) {
		const mod_idx = this.modules.findIndex(m => m.id === mod.id);
		if (mod_idx !== -1) {
			this.modules.splice(mod_idx, 1);
			this.modules.unshift(mod);
		}
	},

	get active_module() {
		return this.modules[0] || null;
	}
});
// endregion

// region srvc_registry
const srvc_registry = reactive({
	key: 'test_value'
});
// endregion

// region srvc_taskbar
const srvc_taskbar = reactive({
	apps: [],

	register(app) {
		this.apps.push(app);
		console.log(`registered taskbar app ${app.title}`);
	}
});
// endregion

// region modules
const global_module_meta = new Map();
const global_module_fonts = new Set();
const global_pixel_fonts = new Map();

let global_module_id = 0;

async function load_module(mod) {
	try {
		const module_id = ++global_module_id;
		if (typeof mod === 'string') {
			console.log(`load_module ${mod} ${module_id}`);
			mod = (await import(mod)).default;
		} else {
			console.log(`load module (internal module) ${module_id}`);
		}

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
		console.error('failed to load module %s', mod);
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

async function load_pixel_font(font_name, json_path, png_path) {
	if (global_pixel_fonts.has(font_name)) {
		console.log(`pixel font ${font_name} already loaded, skipping`);
		return;
	}

	console.log(`load_pixel_font ${font_name} ${json_path} ${png_path}`);

	const [json_res, img] = await Promise.all([
		fetch(json_path).then(r => r.json()),
		new Promise((resolve, reject) => {
			const image = new Image();
			image.onload = () => resolve(image);
			image.onerror = reject;
			image.src = png_path;
		})
	]);

	global_pixel_fonts.set(font_name, {
		metadata: json_res,
		image: img
	});
}
// endregion

// region mod_taskbar
const mod_taskbar = {
	component: {
		extends: c_app_base,

		inject: ['srvc_taskbar', 'sys_state'],
		data() {
			return {
				title: 'Taskbar',
			}
		},

		methods: {
			pointerdown_capture(event) {
				if (this.module)
					this.sys_state.mod_activate(this.module);
			}
		},

		template: `
			<div id="ui-taskbar" @pointerdown.capture="pointerdown_capture">
				<input type="button" v-for="app in srvc_taskbar.apps" :value="app.title"/>
			</div>
		`
	}
};
// endregion

// region bootstrap
(async () => {
	const app = createApp({
		data() {
			return sys_state;
		},

		template: `
			<div
				v-for="(mod, idx) in modules"
				:style="{ zIndex: (modules.length - idx) * 100 }"
				:key="mod.id"
				class="m-container"
			>
				<component
					:is="mod.component"
					v-bind="{ ...mod.props, module: mod, z_idx_base: (modules.length - idx) * 100 }"
				/>
			</div>
		`
	});
	
	// register globals
	app.provide('sys_state', sys_state);
	app.provide('sys_registry', srvc_registry);
	app.provide('srvc_taskbar', srvc_taskbar);
	
	// register components
	app.component('c-ui-button', c_ui_button);
	app.component('c-ui-window', c_ui_window);
	app.component('c-pixel-text', c_pixel_font);

	await Promise.all([
		load_stylesheet('{{asset=css/global.css}}'),
		load_pixel_font('sserife-8pt', '{{asset=fonts/sserife-8pt.json}}', '{{asset=fonts/sserife-8pt.png}}'),
		load_module(mod_taskbar)
	]);

	app.mount('body');

	await load_module('{{asset=js/modules/mod_calc.js}}'); // temp
	await load_module('{{asset=js/modules/mod_calc.js}}'); // temp
})();
// endregion