export default {
	component: {
		inject: ['sys_registry'],

		props: ['module_id'],

		data() {
			return {
			}
		},

		computed: {
			test() {
				return this.sys_registry.key;
			}
		},

		template: `
			<c-ui-window :title="module_id">
				Hello, world! This is some content inside the window!
			</c-ui-window>
			<c-ui-window :title="module_id" :width="500" :height="500"/>
			<c-ui-window :title="module_id"/>
		`
	}
};