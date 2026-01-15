const TILE_SIZE = 64;
const SCREEN_WIDTH = 1024;
const SCREEN_HEIGHT = 640;
const MOVE_SPEED = 3;
const FADE_SPEED = 0.02;

const TILE_COLORS = {
	CHAR_START: { r: 255, g: 0, b: 0 },
	BRICK: { r: 112, g: 89, b: 73 },
	DARK_BRICK: { r: 33, g: 26, b: 22 },
	CRATE: { r: 99, g: 68, b: 51 },
	END_HOLE: { r: 255, g: 0, b: 110 },
	TRAP: { r: 0, g: 255, b: 33 }
};

const ASSETS = [
	'char.png',
	'brick.png',
	'dark_brick.png',
	'crate.png',
	'broken_crate.png',
	'trap.png',
	'end_hole.png',
	'dirt.png',
	'logo.png',
	'logo_flash.png',
	'play_button.png',
	'play_button_flash.png',
	'brazier.png',
	'level_complete.png',
	'no_more.png',
	'start_map.png'
];

const images = {};
let canvas, ctx;
let current_screen = null;
let pending_screen = null;
let fade_alpha = 0;
let fading_in = false;
let fading_out = false;

let mouse_x = 0;
let mouse_y = 0;

function load_assets() {
	return new Promise((resolve) => {
		let loaded = 0;
		const total = ASSETS.length;
		const progress_bar = document.getElementById('loading-progress');

		ASSETS.forEach(asset => {
			const img = new Image();
			img.onload = () => {
				loaded++;
				progress_bar.style.width = ((loaded / total) * 100) + '%';
				if (loaded === total)
					resolve();
			};
			img.onerror = () => {
				console.error('Failed to load:', asset);
				loaded++;
				if (loaded === total)
					resolve();
			};
			img.src = 'static/' + asset;
			images[asset.replace('.png', '')] = img;
		});
	});
}

function load_map(map_name) {
	return new Promise((resolve) => {
		const img = images[map_name];
		const temp_canvas = document.createElement('canvas');
		temp_canvas.width = img.width;
		temp_canvas.height = img.height;
		const temp_ctx = temp_canvas.getContext('2d');
		temp_ctx.drawImage(img, 0, 0);

		const image_data = temp_ctx.getImageData(0, 0, img.width, img.height);
		const pixels = image_data.data;

		const tiles = [];
		const crates = [];
		let spawn = { x: 0, y: 0 };

		for (let y = 0; y < img.height; y++) {
			for (let x = 0; x < img.width; x++) {
				const i = (y * img.width + x) * 4;
				const r = pixels[i];
				const g = pixels[i + 1];
				const b = pixels[i + 2];

				const tile_type = get_tile_type(r, g, b);

				if (tile_type === 'CHAR_START') {
					spawn = { x: x * TILE_SIZE, y: y * TILE_SIZE };
					tiles.push({ x, y, type: 'DARK_BRICK' });
				} else if (tile_type === 'CRATE') {
					crates.push({ x: x * TILE_SIZE, y: y * TILE_SIZE, broken: false });
					tiles.push({ x, y, type: 'DARK_BRICK' });
				} else if (tile_type) {
					tiles.push({ x, y, type: tile_type });
				}
			}
		}

		resolve({ tiles, crates, spawn, width: img.width, height: img.height });
	});
}

function get_tile_type(r, g, b) {
	for (const [type, color] of Object.entries(TILE_COLORS)) {
		if (Math.abs(r - color.r) < 10 && Math.abs(g - color.g) < 10 && Math.abs(b - color.b) < 10)
			return type;
	}

	return null;
}

function color_match(r, g, b, color) {
	return Math.abs(r - color.r) < 10 && Math.abs(g - color.g) < 10 && Math.abs(b - color.b) < 10;
}

function set_screen(screen) {
	if (fading_in || fading_out)
		return;

	pending_screen = screen;
	fading_out = true;
}

function draw_tiled(img, offset_x = 0, offset_y = 0) {
	const start_x = offset_x % img.width - img.width;
	const start_y = offset_y % img.height - img.height;

	for (let x = start_x; x < SCREEN_WIDTH; x += img.width) {
		for (let y = start_y; y < SCREEN_HEIGHT; y += img.height)
			ctx.drawImage(img, x, y);
	}
}

// main screen
function create_main_screen() {
	let logo_alpha = 0;
	let flash_alpha = 0;
	let button_hover = false;

	const logo_x = (SCREEN_WIDTH - images.logo.width) / 2;
	const logo_y = 100;
	const button_x = (SCREEN_WIDTH - images.play_button.width) / 2;
	const button_y = 350;
	const brazier_y = SCREEN_HEIGHT - images.brazier.height - 20;

	return {
		update() {
			if (logo_alpha < 1)
				logo_alpha += 0.01;

			flash_alpha += 0.0001;
			if (flash_alpha > 1)
				flash_alpha = 0;

			button_hover = mouse_x >= button_x && mouse_x <= button_x + images.play_button.width &&
				mouse_y >= button_y && mouse_y <= button_y + images.play_button.height;
		},

		render() {
			draw_tiled(images.brick);

			ctx.globalAlpha = logo_alpha;
			ctx.drawImage(images.logo, logo_x, logo_y);

			ctx.globalAlpha = flash_alpha * logo_alpha;
			ctx.drawImage(images.logo_flash, logo_x, logo_y);
			ctx.globalAlpha = 1;

			ctx.drawImage(images.play_button, button_x, button_y);
			if (button_hover) {
				ctx.globalAlpha = 0.8;
				ctx.drawImage(images.play_button_flash, button_x, button_y);
				ctx.globalAlpha = 1;
			}

			ctx.drawImage(images.brazier, 50, brazier_y);
			ctx.drawImage(images.brazier, SCREEN_WIDTH - images.brazier.width - 50, brazier_y);
		},

		on_click(x, y) {
			if (x >= button_x && x <= button_x + images.play_button.width &&
				y >= button_y && y <= button_y + images.play_button.height)
				set_screen(create_level_screen());
		}
	};
}

// level screen
function create_level_screen() {
	let map_data = null;
	let offset_x = 0;
	let offset_y = 0;
	let moving = { up: false, down: false, left: false, right: false };
	let level_complete = false;

	const player_draw_x = (SCREEN_WIDTH - TILE_SIZE) / 2;
	const player_draw_y = (SCREEN_HEIGHT - TILE_SIZE) / 2;

	load_map('start_map').then(data => {
		map_data = data;
		offset_x = -data.spawn.x + player_draw_x;
		offset_y = -data.spawn.y + player_draw_y;
	});

	function check_collision(new_offset_x, new_offset_y) {
		const player_world_x = player_draw_x - new_offset_x;
		const player_world_y = player_draw_y - new_offset_y;

		const player_left = player_world_x + 3;
		const player_right = player_world_x + TILE_SIZE - 3;
		const player_top = player_world_y + 3;
		const player_bottom = player_world_y + TILE_SIZE - 3;

		// check tile collisions
		for (const tile of map_data.tiles) {
			if (tile.type !== 'BRICK')
				continue;

			const tile_left = tile.x * TILE_SIZE;
			const tile_right = tile_left + TILE_SIZE;
			const tile_top = tile.y * TILE_SIZE;
			const tile_bottom = tile_top + TILE_SIZE;

			if (player_right > tile_left && player_left < tile_right &&
				player_bottom > tile_top && player_top < tile_bottom)
				return false;
		}

		// check crate collisions and push them
		for (const crate of map_data.crates) {
			if (crate.broken)
				continue;

			const crate_left = crate.x + 3;
			const crate_right = crate.x + TILE_SIZE - 3;
			const crate_top = crate.y + 3;
			const crate_bottom = crate.y + TILE_SIZE - 3;

			if (player_right > crate_left && player_left < crate_right &&
				player_bottom > crate_top && player_top < crate_bottom) {
				// push the crate
				const push_x = new_offset_x - offset_x;
				const push_y = new_offset_y - offset_y;

				const new_crate_x = crate.x - push_x;
				const new_crate_y = crate.y - push_y;

				// check if crate can move
				if (!can_crate_move(crate, new_crate_x, new_crate_y))
					return false;

				crate.x = new_crate_x;
				crate.y = new_crate_y;

				// check special tiles
				check_crate_special(crate);
			}
		}

		return true;
	}

	function can_crate_move(moving_crate, new_x, new_y) {
		const crate_left = new_x + 3;
		const crate_right = new_x + TILE_SIZE - 3;
		const crate_top = new_y + 3;
		const crate_bottom = new_y + TILE_SIZE - 3;

		// check walls
		for (const tile of map_data.tiles) {
			if (tile.type !== 'BRICK')
				continue;

			const tile_left = tile.x * TILE_SIZE;
			const tile_right = tile_left + TILE_SIZE;
			const tile_top = tile.y * TILE_SIZE;
			const tile_bottom = tile_top + TILE_SIZE;

			if (crate_right > tile_left && crate_left < tile_right &&
				crate_bottom > tile_top && crate_top < tile_bottom)
				return false;
		}

		// check other crates
		for (const crate of map_data.crates) {
			if (crate === moving_crate || crate.broken)
				continue;

			const other_left = crate.x + 3;
			const other_right = crate.x + TILE_SIZE - 3;
			const other_top = crate.y + 3;
			const other_bottom = crate.y + TILE_SIZE - 3;

			if (crate_right > other_left && crate_left < other_right &&
				crate_bottom > other_top && crate_top < other_bottom)
				return false;
		}

		return true;
	}

	function check_crate_special(crate) {
		const crate_center_x = crate.x + TILE_SIZE / 2;
		const crate_center_y = crate.y + TILE_SIZE / 2;

		for (const tile of map_data.tiles) {
			const tile_left = tile.x * TILE_SIZE;
			const tile_right = tile_left + TILE_SIZE;
			const tile_top = tile.y * TILE_SIZE;
			const tile_bottom = tile_top + TILE_SIZE;

			if (crate_center_x > tile_left && crate_center_x < tile_right &&
				crate_center_y > tile_top && crate_center_y < tile_bottom) {
				if (tile.type === 'TRAP' && !crate.broken)
					crate.broken = true;
				else if (tile.type === 'END_HOLE' && !crate.broken) {
					level_complete = true;
					set_screen(create_level_complete_screen());
				}
			}
		}
	}

	return {
		update() {
			if (!map_data || level_complete)
				return;

			let new_offset_x = offset_x;
			let new_offset_y = offset_y;

			if (moving.up) {
				new_offset_y = offset_y + MOVE_SPEED;
				if (check_collision(new_offset_x, new_offset_y))
					offset_y = new_offset_y;

				new_offset_y = offset_y;
			}

			if (moving.down) {
				new_offset_y = offset_y - MOVE_SPEED;
				if (check_collision(new_offset_x, new_offset_y))
					offset_y = new_offset_y;

				new_offset_y = offset_y;
			}

			if (moving.left) {
				new_offset_x = offset_x + MOVE_SPEED;
				if (check_collision(new_offset_x, new_offset_y))
					offset_x = new_offset_x;

				new_offset_x = offset_x;
			}

			if (moving.right) {
				new_offset_x = offset_x - MOVE_SPEED;
				if (check_collision(new_offset_x, new_offset_y))
					offset_x = new_offset_x;
			}
		},

		render() {
			if (!map_data) {
				ctx.fillStyle = '#000';
				ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
				return;
			}

			// draw dirt background
			draw_tiled(images.dirt, offset_x, offset_y);

			// draw tiles
			for (const tile of map_data.tiles) {
				const draw_x = tile.x * TILE_SIZE + offset_x;
				const draw_y = tile.y * TILE_SIZE + offset_y;

				if (draw_x < -TILE_SIZE || draw_x > SCREEN_WIDTH ||
					draw_y < -TILE_SIZE || draw_y > SCREEN_HEIGHT)
					continue;

				const img_name = tile.type.toLowerCase();
				if (images[img_name])
					ctx.drawImage(images[img_name], draw_x, draw_y);
			}

			// draw crates
			for (const crate of map_data.crates) {
				const draw_x = crate.x + offset_x;
				const draw_y = crate.y + offset_y;

				if (draw_x < -TILE_SIZE || draw_x > SCREEN_WIDTH ||
					draw_y < -TILE_SIZE || draw_y > SCREEN_HEIGHT)
					continue;

				if (crate.broken)
					ctx.drawImage(images.broken_crate, draw_x, draw_y);
				else
					ctx.drawImage(images.crate, draw_x, draw_y);
			}

			// draw player
			ctx.drawImage(images.char, player_draw_x, player_draw_y);
		},

		on_key_down(key) {
			if (key === 'KeyW' || key === 'ArrowUp')
				moving.up = true;
			else if (key === 'KeyS' || key === 'ArrowDown')
				moving.down = true;
			else if (key === 'KeyA' || key === 'ArrowLeft')
				moving.left = true;
			else if (key === 'KeyD' || key === 'ArrowRight')
				moving.right = true;
			else if (key === 'KeyR')
				set_screen(create_level_screen());
		},

		on_key_up(key) {
			if (key === 'KeyW' || key === 'ArrowUp')
				moving.up = false;
			else if (key === 'KeyS' || key === 'ArrowDown')
				moving.down = false;
			else if (key === 'KeyA' || key === 'ArrowLeft')
				moving.left = false;
			else if (key === 'KeyD' || key === 'ArrowRight')
				moving.right = false;
		},

		on_click() {}
	};
}

// level complete screen
function create_level_complete_screen() {
	const complete_x = (SCREEN_WIDTH - images.level_complete.width) / 2;
	const complete_y = 150;
	const no_more_x = (SCREEN_WIDTH - images.no_more.width) / 2;
	const no_more_y = 350;

	return {
		update() {},

		render() {
			ctx.fillStyle = '#000';
			ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
			ctx.drawImage(images.level_complete, complete_x, complete_y);
			ctx.drawImage(images.no_more, no_more_x, no_more_y);
		},

		on_click() {
			set_screen(create_main_screen());
		},

		on_key_down() {},
		on_key_up() {}
	};
}

function update() {
	if (fading_out) {
		fade_alpha += FADE_SPEED;
		if (fade_alpha >= 1) {
			fade_alpha = 1;
			fading_out = false;
			fading_in = true;
			current_screen = pending_screen;
			pending_screen = null;
		}
	} else if (fading_in) {
		fade_alpha -= FADE_SPEED;
		if (fade_alpha <= 0) {
			fade_alpha = 0;
			fading_in = false;
		}
	}

	if (current_screen)
		current_screen.update();
}

function render() {
	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

	if (current_screen)
		current_screen.render();

	// draw fade overlay
	if (fade_alpha > 0) {
		ctx.fillStyle = `rgba(0, 0, 0, ${fade_alpha})`;
		ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
	}
}

function game_loop() {
	update();
	render();
	requestAnimationFrame(game_loop);
}

async function init() {
	canvas = document.getElementById('game');
	ctx = canvas.getContext('2d');

	await load_assets();

	document.getElementById('loading').style.display = 'none';

	current_screen = create_main_screen();

	canvas.addEventListener('mousemove', (e) => {
		const rect = canvas.getBoundingClientRect();
		mouse_x = e.clientX - rect.left;
		mouse_y = e.clientY - rect.top;
	});

	canvas.addEventListener('click', (e) => {
		const rect = canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		if (current_screen && current_screen.on_click && !fading_in && !fading_out)
			current_screen.on_click(x, y);
	});

	document.addEventListener('keydown', (e) => {
		if (current_screen && current_screen.on_key_down && !fading_in && !fading_out)
			current_screen.on_key_down(e.code);
	});

	document.addEventListener('keyup', (e) => {
		if (current_screen && current_screen.on_key_up)
			current_screen.on_key_up(e.code);
	});

	game_loop();
}

init();
