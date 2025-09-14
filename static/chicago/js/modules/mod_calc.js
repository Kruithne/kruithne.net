import { c_app_base } from '../components/c_app_base.js';

export default {
	component: {
		extends: c_app_base,

		data() {
			return {
				title: 'Calculator'
			}
		},

		mounted() {
			this.create_window({
				width: 276,
				height: 271,
				title: this.title,
				content: 'I am a calculator.'
			});

			this.create_window({
				width: 300,
				height: 200,
				title: 'Calculator 2',
				content: 'I am another calculator window.'
			});
		}
	}
};