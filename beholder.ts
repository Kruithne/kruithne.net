import { http_serve } from 'spooder';

type SpooderServer = ReturnType<typeof http_serve>;

const sockets = new Set<WebSocket>();
let interface_code = '';

function is_authenticated_url(url: URL) {
	return url.searchParams.get('key') === process.env.BEHOLDER_KEY;
}

export async function init(server: SpooderServer) {
	server.route('/beholder/interface', (req, url) => {
		if (!is_authenticated_url(url))
			return 401;

		return interface_code;
	});

	server.websocket('/beholder/pipe', {
		accept(req, url) {
			return is_authenticated_url(url);
		},

		close(ws, code, reason) {
			sockets.delete(ws);
		},

		message_json(ws, message) {
			const payload = message as Record<string, any>;

			if (payload.id === 'set_interface') {
				interface_code = payload.code;
			} else {
				// relay to other clients
				const serialized = JSON.stringify(message);
				for (const socket of sockets) {
					if (socket === ws)
						continue;

					socket.send(serialized);
				}
			}
		},

		open(ws) {
			sockets.add(ws);
		},
	});
};