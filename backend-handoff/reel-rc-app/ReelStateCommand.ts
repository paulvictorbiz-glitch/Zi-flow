import {
    IHttp,
    IModify,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import {
    ISlashCommand,
    SlashCommandContext,
} from '@rocket.chat/apps-engine/definition/slashcommands';

/**
 * `/reel-state <reel-id>` — the lightweight Phase-2 fallback to the
 * "📎 Set as reel state" message action.
 *
 * Instead of clicking a specific message, the user runs the command in the
 * channel where they just posted a screen recording; the backend grabs THEIR
 * most-recent video upload in that room and re-hosts it as the reel's current
 * state (same contract as the message-action button and the dashboard picker).
 *
 *   /reel-state REEL-201
 *   /reel-state 201          (bare number → REEL-201)
 */
export class ReelStateCommand implements ISlashCommand {
    public command = 'reel-state';
    public i18nParamsExample = 'reel_state_command_params';
    public i18nDescription = 'reel_state_command_desc';
    public providesPreview = false;

    constructor(private readonly app: App) {}

    private async base(read: IRead): Promise<{ url: string; token: string }> {
        const env = read.getEnvironmentReader().getSettings();
        const url = (await env.getValueById('reel_backend_url')) || 'http://backend:8000';
        const token = (await env.getValueById('reel_token')) || '';
        return { url: String(url).replace(/\/$/, ''), token: String(token) };
    }

    public async executor(
        context: SlashCommandContext,
        read: IRead,
        modify: IModify,
        http: IHttp,
        _persis: IPersistence,
    ): Promise<void> {
        const args = context.getArguments();
        if (!args.length || !args[0].trim()) {
            await this.notify(context, read, modify,
                'Usage: `/reel-state REEL-201` — attaches your most recent ' +
                'screen recording in this channel as that reel\'s current state. ' +
                'For a specific message, use the "📎 Set as reel state" action instead.');
            return;
        }

        let reelId = args[0].trim();
        if (/^\d+$/.test(reelId)) {
            reelId = `REEL-${reelId}`;
        }

        const room: any = context.getRoom();
        const sender = context.getSender();
        const channel = room.slugifiedName || room.displayName || room.name || '';
        const isPrivate = room.type === 'p';

        if (!channel) {
            await this.notify(context, read, modify,
                '⚠️ `/reel-state` only works in a named channel or private group.');
            return;
        }

        const { url, token } = await this.base(read);
        let ok = false;
        let errMsg = '';
        let fileName = '';
        let resolvedId = reelId;
        try {
            const res = await http.post(`${url}/api/rocketchat/app/attach-recent-recording`, {
                headers: { 'Content-Type': 'application/json' },
                data: {
                    token,
                    reel_id: reelId,
                    channel,
                    private: isPrivate ? 1 : 0,
                    user_name: sender.username,
                },
            });
            const d = (res && res.data) || {};
            ok = !!d.ok;
            errMsg = d.error || '';
            fileName = d.file_name || '';
            if (d.reel_id) {
                resolvedId = d.reel_id;
            }
        } catch (e) {
            this.app.getLogger().error('reel-state slash attach failed', e);
            errMsg = 'backend unreachable';
        }

        const text = ok
            ? `✅ Set${fileName ? ` \`${fileName}\`` : ' your latest recording'} as the current reel state for *${resolvedId}*.`
            : `⚠️ Couldn't set the reel state${errMsg ? `: ${errMsg}` : '.'}`;
        await this.notify(context, read, modify, text);
    }

    private async notify(
        context: SlashCommandContext,
        read: IRead,
        modify: IModify,
        text: string,
    ): Promise<void> {
        const sender = (await read.getUserReader().getAppUser()) || context.getSender();
        const msg = modify.getCreator().startMessage()
            .setRoom(context.getRoom())
            .setSender(sender)
            .setText(text);
        await modify.getNotifier().notifyUser(context.getSender(), msg.getMessage());
    }
}
