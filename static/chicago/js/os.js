import { createApp, reactive } from '/{{cache_bust=static/chicago/js/lib/vue.esm.prod.js}}';

// region generic
const EMPTY_ARRAY = new Array(0);
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
const global_module_meta = new Map();

async function load_module(module_path) {
	try {
		const module_id = crypto.randomUUID();
		console.log(`load_module ${module_path} ${module_id}`);

		const mod = (await import(module_path)).default;

		const stylesheets = mod.stylesheets ?? EMPTY_ARRAY;
		for (const href of stylesheets)
			await load_stylesheet(href);

		sys_state.modules.push({
			id: module_id,
			component: mod.component,
			props: { module_id }
		});

		global_module_meta.set(module_id, { stylesheets });
		
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

	const meta = global_module_meta.get(module_id);
	if (meta !== undefined) {
		for (const href of meta.stylesheets)
			unload_stylesheet(href);
	}

	global_module_meta.delete(module_id);
}

async function load_stylesheet(href) {
	console.log(`load_stylesheet ${href}`);
	return new Promise((resolve, reject) => {
		const existing = document.querySelector(`link[href="${href}"]`);
		if (existing !== null) {
			existing.setAttribute('data-users', Number(existing.getAttribute('data-users')) + 1);
			return resolve();
		}

		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = href;
		link.setAttribute('data-users', 1);

		link.onload = () => resolve();
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

	const state = app.mount('body');

	const test = await load_module('/{{cache_bust=static/chicago/js/modules/mod_test.js}}');
	setTimeout(() => unload_module(test), 3000);
})();
// endregion