const PAPER = '#f7f1eb';
const INK = '#261c13';
(function() {
	const wrapper = document.createElement('div');
	wrapper.id = 'snake-wrapper';

	const canvas = document.createElement('canvas');
	canvas.width = 300;
	canvas.height = 300;
	canvas.tabIndex = 0;

	wrapper.appendChild(canvas);
	document.querySelector('section').appendChild(wrapper);

	const ctx = canvas.getContext('2d');
	const grid_size = 15;
	const tile_count = canvas.width / grid_size;

	let snake, direction, food, game_running, score;
	let last_update = 0;
	const tick_rate = 100;

	function init() {
		snake = [{ x: 10, y: 10 }];
		direction = { x: 0, y: 0 };
		food = spawn_food();
		game_running = false;
		score = 0;
		draw_start();
	}

	function spawn_food() {
		let pos;
		do {
			pos = {
				x: Math.floor(Math.random() * tile_count),
				y: Math.floor(Math.random() * tile_count)
			};
		} while (snake.some(s => s.x === pos.x && s.y === pos.y));
		return pos;
	}

	function draw_start() {
		ctx.fillStyle = PAPER;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = INK;
		ctx.font = '24px "Google Sans Code", monospace';
		ctx.textAlign = 'center';
		ctx.fillText('PLAY', canvas.width / 2, canvas.height / 2 + 8);
	}

	function draw_game_over() {
		ctx.fillStyle = PAPER;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = INK;
		ctx.font = '24px "Google Sans Code", monospace';
		ctx.textAlign = 'center';
		ctx.fillText('GAME OVER: ' + score, canvas.width / 2, canvas.height / 2 + 8);
	}

	function game_over() {
		game_running = false;
		draw_game_over();
	}

	function draw_cross(x, y) {
		const cx = x * grid_size + grid_size / 2;
		const cy = y * grid_size + grid_size / 2;
		const size = 4;
		ctx.strokeStyle = INK;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(cx - size, cy - size);
		ctx.lineTo(cx + size, cy + size);
		ctx.moveTo(cx + size, cy - size);
		ctx.lineTo(cx - size, cy + size);
		ctx.stroke();
	}

	function draw() {
		ctx.fillStyle = PAPER;
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		ctx.fillStyle = INK;
		ctx.font = '12px "Google Sans Code", monospace';
		ctx.textAlign = 'left';
		ctx.fillText('SCORE: ' + score, 5, 12);

		ctx.fillStyle = INK;
		snake.forEach(s => ctx.fillRect(s.x * grid_size + 1, s.y * grid_size + 1, grid_size - 2, grid_size - 2));

		draw_cross(food.x, food.y);
	}

	function update(timestamp) {
		requestAnimationFrame(update);

		if (!game_running) return;
		if (timestamp - last_update < tick_rate) return;
		last_update = timestamp;

		const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

		if (head.x < 0 || head.x >= tile_count || head.y < 0 || head.y >= tile_count ||
			snake.some(s => s.x === head.x && s.y === head.y)) {
			game_over();
			return;
		}

		snake.unshift(head);

		if (head.x === food.x && head.y === food.y) {
			food = spawn_food();
			score++;
		} else {
			snake.pop();
		}

		draw();
	}

	function start_game() {
		if (game_running) return;
		snake = [{ x: 10, y: 10 }];
		direction = { x: 1, y: 0 };
		food = spawn_food();
		score = 0;
		game_running = true;
		draw();
	}

	function handle_direction(new_dir) {
		if (new_dir === 'up' && direction.y !== 1) direction = { x: 0, y: -1 };
		else if (new_dir === 'down' && direction.y !== -1) direction = { x: 0, y: 1 };
		else if (new_dir === 'left' && direction.x !== 1) direction = { x: -1, y: 0 };
		else if (new_dir === 'right' && direction.x !== -1) direction = { x: 1, y: 0 };
	}

	canvas.addEventListener('click', function(e) {
		if (!game_running) {
			start_game();
			return;
		}

		const rect = canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const cx = rect.width / 2;
		const cy = rect.height / 2;

		const dx = x - cx;
		const dy = y - cy;

		if (Math.abs(dx) > Math.abs(dy)) {
			handle_direction(dx > 0 ? 'right' : 'left');
		} else {
			handle_direction(dy > 0 ? 'down' : 'up');
		}
	});

	canvas.addEventListener('keydown', function(e) {
		if (e.key.startsWith('Arrow')) {
			e.preventDefault();
		}

		if (!game_running && (e.key === ' ' || e.key === 'Enter')) {
			start_game();
			return;
		}

		const key = e.key;
		if (key === 'ArrowUp' || key === 'w') handle_direction('up');
		else if (key === 'ArrowDown' || key === 's') handle_direction('down');
		else if (key === 'ArrowLeft' || key === 'a') handle_direction('left');
		else if (key === 'ArrowRight' || key === 'd') handle_direction('right');
	});

	init();
	requestAnimationFrame(update);
})();
