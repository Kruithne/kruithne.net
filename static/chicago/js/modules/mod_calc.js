export default {
	component: {
		inject: ['srvc_taskbar'],

		data() {
			return {
				title: 'Calculator'
			}
		},

		created() {
			this.srvc_taskbar.register(this);
		},

		template: `
			<c-ui-window :title="title" :width="276" :height="271">
				I am a calculator.
			</c-ui-window>
		`
	}
};