export default {
	preload: [
		'{{asset=css/test_css_1.css}}',
		'{{asset=fonts/OCRAEXT.TTF}}',
		'{{asset=images/test_image.webp}}'
	],

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
			<h1>{{ test }}</h1>
			<c-ui-button label="Cancel"/>
			{{ module_id }}
			<img src="{{asset=images/test_image.webp}}"/>
		`
	}
};