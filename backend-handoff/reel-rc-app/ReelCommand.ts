import {
    IHttp,
    IModify,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import {
    ISlashCommand,
    ISlashCommandPreview,
    ISlashCommandPreviewItem,
    SlashCommandContext,
    SlashCommandPreviewItemType,
} from '@rocket.chat/apps-engine/definition/slashcommands';
import { App } from '@rocket.chat/apps-engine/definition/App';

/**
 * /reel — pick a pipeline reel from a dropdown, then attach feedback.
 *
 *  · Typing `/reel` (or `/reel jump`) shows an autocomplete dropdown of
 *    matching reels (id — title). Scroll or keep typing to filter; Enter
 *    selects one.
 *  · After selecting, type your feedback after the id and send: the feedback
 *    is saved as a comment on that reel in the FootageBrain dashboard, and a
 *    confirmation card is posted to the channel.
 *
 * The dropdown is powered by the App's `previewer`, which queries the backend
 * `/api/rocketchat/reels/search` endpoint. Selecting an item runs
 * `executePreviewItem`, which posts to `/api/rocketchat/slash/reel` with an
 * explicit `reel_id` so the backend treats the trailing text as pure feedback.
 */
export class ReelCommand implements ISlashCommand {
    public command = 'reel';
    public i18nParamsExample = 'reel_command_params';
    public i18nDescription = 'reel_command_desc';
    public providesPreview = true;

    constructor(private readonly app: App) {}

    private async base(read: IRead): Promise<{ url: string; token: string }> {
        const env = read.getEnvironmentReader().getSettings();
        const url = (await env.getValueById('reel_backend_url')) || 'http://backend:8000';
        const token = (await env.getValueById('reel_token')) || '';
        return { url: String(url).replace(/\/$/, ''), token: String(token) };
    }

    /** Build the dropdown from the backend search endpoint. */
    public async previewer(
        context: SlashCommandContext,
        read: IRead,
        modify: IModify,
        http: IHttp,
    ): Promise<ISlashCommandPreview> {
        const query = context.getArguments().join(' ').trim();
        const { url, token } = await this.base(read);

        let items: Array<ISlashCommandPreviewItem> = [];
        try {
            const res = await http.get(
                `${url}/api/rocketchat/reels/search?q=${encodeURIComponent(query)}&limit=8`,
                { headers: { 'X-Reel-Token': token } },
            );
            const data = (res.data && res.data.items) || [];
            items = data.map((r: any) => ({
                id: r.id,
                type: SlashCommandPreviewItemType.TEXT,
                value: `${r.id} — ${r.title}${r.stage ? `  [${r.stage}]` : ''}`,
            }));
        } catch (e) {
            this.app.getLogger().error('reel search failed', e);
        }

        if (!items.length) {
            items = [{
                id: '__none__',
                type: SlashCommandPreviewItemType.TEXT,
                value: query ? `No reel matches "${query}"` : 'Type to search reels…',
            }];
        }

        return {
            i18nTitle: 'reel_preview_title',
            items,
        };
    }

    /** Runs when the user picks an item from the dropdown. */
    public async executePreviewItem(
        item: ISlashCommandPreviewItem,
        context: SlashCommandContext,
        read: IRead,
        modify: IModify,
        http: IHttp,
        persis: IPersistence,
    ): Promise<void> {
        if (item.id === '__none__') {
            return;
        }
        // item.id is the reel id. Any text the user typed beyond the search
        // terms can't be reliably separated here, so on pick we post the
        // reference card; feedback is added by typing `/reel REEL-ID <feedback>`
        // and sending (handled in execute()).
        await this.callBackend(item.id, '', context, read, http);
    }

    /** Runs when the user just sends `/reel <args>` without picking a preview. */
    public async executor(
        context: SlashCommandContext,
        read: IRead,
        modify: IModify,
        http: IHttp,
        persis: IPersistence,
    ): Promise<void> {
        const args = context.getArguments();
        if (!args.length) {
            await this.notify(context, modify,
                'Usage: `/reel <id or title>` — pick from the dropdown, then ' +
                'add feedback like `/reel REEL-201 tighten the hook`.');
            return;
        }
        const first = args[0];
        const rest = args.slice(1).join(' ').trim();

        // If the first token is a concrete reel id, send id + feedback.
        if (/^reel-\d+$/i.test(first)) {
            await this.callBackend(first, rest, context, read, http);
        } else {
            // Title search — let the backend resolve / list matches.
            await this.callBackendRaw(args.join(' '), context, read, http);
        }
    }

    private async callBackend(
        reelId: string,
        feedback: string,
        context: SlashCommandContext,
        read: IRead,
        http: IHttp,
    ): Promise<void> {
        const { url, token } = await this.base(read);
        const room = context.getRoom();
        const sender = context.getSender();
        try {
            await http.post(`${url}/api/rocketchat/slash/reel`, {
                headers: { 'Content-Type': 'application/json' },
                data: {
                    token,
                    reel_id: reelId,
                    text: feedback,
                    channel_id: room.id,
                    channel_name: (room as any).slugifiedName || (room as any).displayName || 'team',
                    user_id: sender.id,
                    user_name: sender.username,
                },
            });
        } catch (e) {
            this.app.getLogger().error('reel callBackend failed', e);
        }
    }

    private async callBackendRaw(
        text: string,
        context: SlashCommandContext,
        read: IRead,
        http: IHttp,
    ): Promise<void> {
        const { url, token } = await this.base(read);
        const room = context.getRoom();
        const sender = context.getSender();
        try {
            await http.post(`${url}/api/rocketchat/slash/reel`, {
                headers: { 'Content-Type': 'application/json' },
                data: {
                    token,
                    text,
                    channel_id: room.id,
                    channel_name: (room as any).slugifiedName || (room as any).displayName || 'team',
                    user_id: sender.id,
                    user_name: sender.username,
                },
            });
        } catch (e) {
            this.app.getLogger().error('reel callBackendRaw failed', e);
        }
    }

    private async notify(
        context: SlashCommandContext,
        modify: IModify,
        text: string,
    ): Promise<void> {
        const msg = modify.getCreator().startMessage()
            .setRoom(context.getRoom())
            .setSender(context.getSender())
            .setText(text);
        await modify.getNotifier().notifyUser(context.getSender(), msg.getMessage());
    }
}
