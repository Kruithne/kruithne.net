import { log_create_logger, caution } from 'spooder';

const log = log_create_logger('discord', '#5865F2ff');

const DISCORD_API = 'https://discord.com/api/v10';

type DiscordCredentials = {
	token: string;
	channel_ids: string[];
};

type DiscordPostConfig = {
	title: string;
	description: string;
	url: string;
	image_url?: string;
};

function get_credentials(): DiscordCredentials | null {
	const token = process.env.DISCORD_TOKEN;
	const channel_ids_raw = process.env.DISCORD_CHANNEL_IDS;

	if (!token || !channel_ids_raw)
		return null;

	const channel_ids = channel_ids_raw.split(',').map(id => id.trim()).filter(id => id.length > 0);
	if (channel_ids.length === 0)
		return null;

	return { token, channel_ids };
}

async function send_message(
	token: string,
	channel_id: string,
	config: DiscordPostConfig
): Promise<string> {
	const url = `${DISCORD_API}/channels/${channel_id}/messages`;

	const embed: Record<string, unknown> = {
		title: config.title,
		description: config.description,
		url: config.url,
		color: 0xFFD700 // gold color
	};

	if (config.image_url)
		embed.image = { url: config.image_url };

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Authorization': `Bot ${token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ embeds: [embed] })
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`failed to send message to channel ${channel_id}: ${response.status} ${error}`);
	}

	const result = await response.json() as { id: string };
	return result.id;
}

export async function discord_post(config: DiscordPostConfig): Promise<string[] | null> {
	const credentials = get_credentials();
	if (!credentials) {
		log`{skipping post - credentials not configured}`;
		return null;
	}

	const message_ids: string[] = [];

	for (const channel_id of credentials.channel_ids) {
		try {
			log`{posting to channel ${channel_id}}`;
			const message_id = await send_message(credentials.token, channel_id, config);
			log`{posted successfully to ${channel_id}} {message: ${message_id}}`;
			message_ids.push(message_id);
		} catch (err) {
			caution(`failed to post to discord channel ${channel_id}`, { err });
		}
	}

	return message_ids;
}
