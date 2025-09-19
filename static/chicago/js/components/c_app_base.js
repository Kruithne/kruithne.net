let global_window_id = 0;

export const c_app_base = {
	inject: ['srvc_taskbar'],

	props: {
		module: { type: Object, required: true },
		z_idx_base: { type: Number, default: 100 }
	},

	data() {
		return {
			windows: []
		}
	},

	methods: {
		create_window(config) {
			this.windows.push({
				id: ++global_window_id,
				width: config.width || 200,
				height: config.height || 150,
				title: config.title || 'New Window',
				content: config.content || ''
			});
		}
	},

	created() {
		if (this.srvc_taskbar)
			this.srvc_taskbar.register(this);
	},

	template: `
		<div>
			<c-ui-window
				v-for="(win, idx) in windows"
				:key="win.id"
				:style="{ zIndex: z_idx_base + (windows.length - idx) }"
				:width="win.width"
				:height="win.height"
				:title="win.title"
				:module="module"
				:win_idx="idx"
			>
				<div v-html="win.content"></div>
			</c-ui-window>
		</div>
	`
};