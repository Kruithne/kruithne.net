import * as tls from 'tls';
import * as crypto from 'crypto';

type SMTPConfig = {
	host: string;
	port: number;
	user: string;
	pass: string;
};

type SMTPMessage = {
	from: string;
	to: string;
	cc?: string;
	bcc?: string;
	subject: string;
	text?: string;
	html?: string;
};

type SMTPSendConfig = {
	uri: string;
} & SMTPMessage;

type SMTPResponse = {
	accepted: string[];
	rejected: string[];
	response: string;
	message_id: string;
};

function parse_connection_string(uri: string): SMTPConfig {
	const match = uri.match(/^([^:]+):([^@]+)@([^:]+):(\d+)$/);
	if (!match)
		throw new Error('invalid connection string format, expected: user:pass@host:port');

	return {
		user: decodeURIComponent(match[1]),
		pass: decodeURIComponent(match[2]),
		host: match[3],
		port: parseInt(match[4])
	};
}

async function smtp_send_command(socket: tls.TLSSocket, command: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			socket.off('data', on_data);
			socket.off('error', on_error);
			reject(new Error(`smtp command timeout (buffer: ${buffer})`));
		}, 30000);

		let buffer = '';

		const on_data = (chunk: Buffer) => {
			buffer += chunk.toString();

			const lines = buffer.split(/\r?\n/);

			// incomplete line at end, keep in buffer
			if (!buffer.endsWith('\n')) {
				buffer = lines.pop() || '';
				if (lines.length === 0)
					return;
			} else {
				buffer = '';
			}

			// filter out empty lines
			const non_empty_lines = lines.filter(l => l.length > 0);
			if (non_empty_lines.length === 0)
				return;

			// check if response is complete (last line format: "123 " not "123-")
			const last_line = non_empty_lines[non_empty_lines.length - 1];
			if (last_line && /^\d{3} /.test(last_line)) {
				clearTimeout(timeout);
				socket.off('data', on_data);
				socket.off('error', on_error);
				resolve(lines.join('\n'));
			}
		};

		const on_error = (err: Error) => {
			clearTimeout(timeout);
			socket.off('data', on_data);
			socket.off('error', on_error);
			reject(err);
		};

		socket.on('data', on_data);
		socket.once('error', on_error);
		socket.write(command + '\r\n');
	});
}

async function smtp_read_greeting(socket: tls.TLSSocket): Promise<string> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			socket.off('data', on_data);
			socket.off('error', on_error);
			reject(new Error(`smtp greeting timeout (buffer: ${buffer})`));
		}, 30000);

		let buffer = '';

		const on_data = (chunk: Buffer) => {
			buffer += chunk.toString();

			const lines = buffer.split(/\r?\n/);

			if (!buffer.endsWith('\n')) {
				buffer = lines.pop() || '';
				if (lines.length === 0)
					return;
			} else {
				buffer = '';
			}

			// filter out empty lines
			const non_empty_lines = lines.filter(l => l.length > 0);
			if (non_empty_lines.length === 0)
				return;

			const last_line = non_empty_lines[non_empty_lines.length - 1];
			if (last_line && /^\d{3} /.test(last_line)) {
				clearTimeout(timeout);
				socket.off('data', on_data);
				socket.off('error', on_error);
				resolve(lines.join('\n'));
			}
		};

		const on_error = (err: Error) => {
			clearTimeout(timeout);
			socket.off('data', on_data);
			socket.off('error', on_error);
			reject(err);
		};

		socket.on('data', on_data);
		socket.once('error', on_error);
	});
}

async function smtp_connect(config: SMTPConfig): Promise<tls.TLSSocket> {
	return new Promise((resolve, reject) => {
		let connection_timeout = setTimeout(() => {
			socket.destroy();
			reject(new Error('connection timeout'));
		}, 120000);

		const socket = tls.connect({
			host: config.host,
			port: config.port,
			rejectUnauthorized: false
		}, () => {
			clearTimeout(connection_timeout);
			socket.setTimeout(600000);
			resolve(socket);
		});

		socket.on('error', (err) => {
			clearTimeout(connection_timeout);
			reject(err);
		});

		socket.on('timeout', () => {
			socket.destroy();
			reject(new Error('socket timeout'));
		});
	});
}

async function smtp_auth(socket: tls.TLSSocket, config: SMTPConfig): Promise<void> {
	const ehlo_response = await smtp_send_command(socket, `EHLO ${config.host}`);
	if (!ehlo_response.startsWith('250'))
		throw new Error(`ehlo failed: ${ehlo_response}`);

	const auth_response = await smtp_send_command(socket, 'AUTH LOGIN');
	if (!auth_response.startsWith('334'))
		throw new Error(`auth login failed: ${auth_response}`);

	const user_b64 = Buffer.from(config.user).toString('base64');
	const user_response = await smtp_send_command(socket, user_b64);
	if (!user_response.startsWith('334'))
		throw new Error(`auth user failed: ${user_response}`);

	const pass_b64 = Buffer.from(config.pass).toString('base64');
	const pass_response = await smtp_send_command(socket, pass_b64);
	if (!pass_response.startsWith('235'))
		throw new Error(`auth pass failed: ${pass_response}`);
}

function parse_email_addresses(field: string): string[] {
	return field.split(',').map(e => e.trim()).filter(e => e.length > 0);
}

function extract_email_address(field: string): string {
	const match = field.match(/<([^>]+)>/);
	return match ? match[1] : field.trim();
}

function apply_dot_stuffing(content: string): string {
	const lines = content.split('\n');
	const result: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];

		// remove \r if present
		if (line.endsWith('\r'))
			line = line.slice(0, -1);

		// dot stuff lines starting with .
		if (line.startsWith('.'))
			line = '.' + line;

		result.push(line);
	}

	return result.join('\r\n');
}

function build_mime_message(message: SMTPMessage): { mime: string; message_id: string } {
	const boundary = `----boundary_${crypto.randomBytes(16).toString('hex')}`;
	const from_domain = extract_email_address(message.from).split('@')[1] || 'localhost';
	const message_id = `<${crypto.randomBytes(16).toString('hex')}@${from_domain}>`;
	const date = new Date().toUTCString();

	let mime = '';
	mime += `From: ${message.from}\r\n`;
	mime += `To: ${message.to}\r\n`;
	if (message.cc)
		mime += `Cc: ${message.cc}\r\n`;
	mime += `Subject: ${message.subject}\r\n`;
	mime += `Message-ID: ${message_id}\r\n`;
	mime += `Date: ${date}\r\n`;
	mime += `MIME-Version: 1.0\r\n`;

	if (message.text && message.html) {
		mime += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n`;
		mime += `\r\n`;
		mime += `--${boundary}\r\n`;
		mime += `Content-Type: text/plain; charset=utf-8\r\n`;
		mime += `Content-Transfer-Encoding: 7bit\r\n`;
		mime += `\r\n`;
		mime += `${message.text}\r\n`;
		mime += `--${boundary}\r\n`;
		mime += `Content-Type: text/html; charset=utf-8\r\n`;
		mime += `Content-Transfer-Encoding: 7bit\r\n`;
		mime += `\r\n`;
		mime += `${message.html}\r\n`;
		mime += `--${boundary}--\r\n`;
	} else if (message.html) {
		mime += `Content-Type: text/html; charset=utf-8\r\n`;
		mime += `Content-Transfer-Encoding: 7bit\r\n`;
		mime += `\r\n`;
		mime += `${message.html}\r\n`;
	} else if (message.text) {
		mime += `Content-Type: text/plain; charset=utf-8\r\n`;
		mime += `Content-Transfer-Encoding: 7bit\r\n`;
		mime += `\r\n`;
		mime += `${message.text}\r\n`;
	}

	return { mime, message_id };
}

export function smtp_create_mailer(uri: string) {
	const config = parse_connection_string(uri);

	let socket: tls.TLSSocket | null = null;

	const ensure_connection = async () => {
		if (socket && !socket.destroyed) {
			return;
		}

		socket = await smtp_connect(config);

		await smtp_read_greeting(socket);
		await smtp_auth(socket, config);
	};

	return {
		send: async (message: SMTPMessage): Promise<SMTPResponse> => {
			await ensure_connection();

			if (!socket)
				throw new Error('connection failed');

			try {
				const from_addr = extract_email_address(message.from);
				const mail_response = await smtp_send_command(socket, `MAIL FROM:<${from_addr}>`);
				if (!mail_response.startsWith('250'))
					throw new Error(`mail from failed: ${mail_response}`);

				const recipients: string[] = [];
				const accepted: string[] = [];
				const rejected: string[] = [];

				recipients.push(...parse_email_addresses(message.to).map(extract_email_address));
				if (message.cc)
					recipients.push(...parse_email_addresses(message.cc).map(extract_email_address));
				if (message.bcc)
					recipients.push(...parse_email_addresses(message.bcc).map(extract_email_address));

				for (const rcpt of recipients) {
					const rcpt_response = await smtp_send_command(socket, `RCPT TO:<${rcpt}>`);
					if (rcpt_response.startsWith('250'))
						accepted.push(rcpt);
					else
						rejected.push(rcpt);
				}

				if (accepted.length === 0)
					throw new Error('all recipients rejected');

				const data_response = await smtp_send_command(socket, 'DATA');
				if (!data_response.startsWith('354'))
					throw new Error(`data command failed: ${data_response}`);

				const { mime, message_id } = build_mime_message(message);
				const stuffed_mime = apply_dot_stuffing(mime);
				const send_response = await smtp_send_command(socket, stuffed_mime + '\r\n.');
				if (!send_response.startsWith('250'))
					throw new Error(`message send failed: ${send_response}`);

				return {
					accepted,
					rejected,
					response: send_response.trim(),
					message_id
				};
			} catch (err) {
				// connection-level error, mark socket as dead
				if (socket && !socket.destroyed)
					socket.destroy();

				socket = null;
				throw err;
			}
		},

		close: async () => {
			if (!socket || socket.destroyed)
				return;

			try {
				await smtp_send_command(socket, 'QUIT');
			} catch (err) {
				// ignore quit errors
			} finally {
				socket.end();
				socket = null;
			}
		}
	};
}

export async function smtp_send(config: SMTPSendConfig): Promise<SMTPResponse> {
	const mailer = smtp_create_mailer(config.uri);

	try {
		return await mailer.send({
			from: config.from,
			to: config.to,
			cc: config.cc,
			bcc: config.bcc,
			subject: config.subject,
			text: config.text,
			html: config.html
		});
	} finally {
		await mailer.close();
	}
}
