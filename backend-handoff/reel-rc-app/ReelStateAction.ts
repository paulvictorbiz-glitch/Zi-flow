import {
    IHttp,
    IModify,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import {
    RocketChatAssociationModel,
    RocketChatAssociationRecord,
} from '@rocket.chat/apps-engine/definition/metadata';
import {
    IUIKitResponse,
    UIKitActionButtonInteractionContext,
    UIKitViewSubmitInteractionContext,
} from '@rocket.chat/apps-engine/definition/uikit';

/**
 * Phase 2 — Rocket.Chat-NATIVE "Set as reel state".
 *
 * A message-action button ("📎 Set as reel state", registered in
 * ReelCommandApp.extendConfiguration) lets an editor turn a screen recording
 * they just posted into a channel into a reel's "Current reel state" WITHOUT
 * leaving chat. Clicking it on a video message opens a small modal reel-picker;
 * on submit we call the backend's shared-secret-gated
 * `POST /api/rocketchat/app/attach-recording`, which runs the SAME
 * download → transcode → re-host → media_path logic the dashboard "Pick from
 * Chat" picker (Phase 1) already uses — so the attached state shows up
 * identically in the FootageBrain reel card.
 *
 * The App holds REEL_SLASH_TOKEN (the slash shared secret), not a Supabase JWT,
 * so it hits the `/app/*` shared-secret endpoint rather than the browser
 * `/dashboard/*` JWT one.
 */

export const REEL_STATE_ACTION_ID = 'reel-state-attach';
const VIEW_ID = 'reel-state-modal';
const BLOCK_ID = 'reel_state_id';
const BLOCK_SEL = 'reel_state_sel';
const ACTION_REEL_ID = 'reel_id';
const ACTION_REEL_SELECT = 'reel_select';

const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'm4v', 'mkv'];

interface IFileCtx {
    fileId: string;
    name: string;
    channel: string;
    private: boolean;
    roomId: string;
}

/** Backend base URL + shared token from the App settings (same as ReelCommand). */
async function base(read: IRead): Promise<{ url: string; token: string }> {
    const env = read.getEnvironmentReader().getSettings();
    const url = (await env.getValueById('reel_backend_url')) || 'http://backend:8000';
    const token = (await env.getValueById('reel_token')) || '';
    return { url: String(url).replace(/\/$/, ''), token: String(token) };
}

/** Find the first VIDEO upload on a message (single `file` or a `files[]`). */
function extractVideoFile(message: any): { id: string; name: string } | null {
    const candidates: any[] = [];
    if (message && message.file) {
        candidates.push(message.file);
    }
    if (message && Array.isArray(message.files)) {
        candidates.push(...message.files);
    }
    for (const f of candidates) {
        if (!f) {
            continue;
        }
        const id = f._id || f.id;
        if (!id) {
            continue;
        }
        const type = String(f.type || '').toLowerCase();
        const name = String(f.name || '').toLowerCase();
        const ext = name.includes('.') ? name.split('.').pop() || '' : '';
        if (type.startsWith('video/') || VIDEO_EXTS.indexOf(ext) !== -1) {
            return { id, name: f.name || 'recording.mp4' };
        }
    }
    return null;
}

/** Recent (or matching) reels for the modal's convenience dropdown. */
async function fetchRecentReels(
    read: IRead,
    http: IHttp,
): Promise<Array<{ id: string; title: string; stage: string }>> {
    const { url, token } = await base(read);
    try {
        const res = await http.get(`${url}/api/rocketchat/reels/search?q=&limit=25`, {
            headers: { 'X-Reel-Token': token },
        });
        const data = (res.data && res.data.items) || [];
        return data.map((r: any) => ({
            id: r.id,
            title: r.title || '(untitled)',
            stage: r.stage || '',
        }));
    } catch (e) {
        return [];
    }
}

/** Ephemeral note back to the clicking user (only they see it). */
async function notify(
    read: IRead,
    modify: IModify,
    roomId: string | null | undefined,
    user: any,
    text: string,
): Promise<void> {
    if (!roomId) {
        return;
    }
    try {
        const room = await read.getRoomReader().getById(roomId);
        if (!room) {
            return;
        }
        const sender = (await read.getUserReader().getAppUser()) || user;
        const msg = modify
            .getCreator()
            .startMessage()
            .setRoom(room)
            .setSender(sender)
            .setText(text);
        await modify.getNotifier().notifyUser(user, msg.getMessage());
    } catch (e) {
        /* best-effort */
    }
}

/** Build the reel-picker modal: a typed id field + a recent-reels dropdown. */
function buildModal(
    modify: IModify,
    file: { name: string },
    reels: Array<{ id: string; title: string }>,
): any {
    const block = modify.getCreator().getBlockBuilder();
    block.addSectionBlock({
        text: block.newMarkdownTextObject(
            `📎 *Set as current reel state*\nRecording: \`${file.name}\``,
        ),
    });
    block.addInputBlock({
        blockId: BLOCK_ID,
        label: block.newPlainTextObject('Reel ID'),
        optional: true,
        element: block.newPlainTextInputElement({
            actionId: ACTION_REEL_ID,
            placeholder: block.newPlainTextObject('e.g. REEL-201'),
        }),
    });
    if (reels.length) {
        block.addInputBlock({
            blockId: BLOCK_SEL,
            label: block.newPlainTextObject('…or pick a recent reel'),
            optional: true,
            element: block.newStaticSelectElement({
                actionId: ACTION_REEL_SELECT,
                placeholder: block.newPlainTextObject('Recent reels'),
                options: reels.slice(0, 25).map((r) => {
                    const label = `${r.id} — ${r.title}`;
                    return {
                        text: block.newPlainTextObject(
                            label.length > 75 ? `${label.slice(0, 72)}…` : label,
                        ),
                        value: r.id,
                    };
                }),
            }),
        });
    }
    return {
        id: VIEW_ID,
        title: block.newPlainTextObject('Set reel state'),
        submit: block.newButtonElement({ text: block.newPlainTextObject('Attach') }),
        blocks: block.getBlocks(),
    };
}

/** Message-action button clicked → stash the file context + open the modal. */
export async function handleReelStateButton(
    app: App,
    context: UIKitActionButtonInteractionContext,
    read: IRead,
    http: IHttp,
    persistence: IPersistence,
    modify: IModify,
): Promise<IUIKitResponse> {
    const data = context.getInteractionData();
    const { user, room, message, triggerId } = data as any;

    const file = extractVideoFile(message);
    if (!file) {
        await notify(
            read,
            modify,
            room && room.id,
            user,
            '⚠️ That message has no video upload to set as a reel state. ' +
                'Use this on a message with a screen recording.',
        );
        return context.getInteractionResponder().successResponse();
    }

    const ctx: IFileCtx = {
        fileId: file.id,
        name: file.name,
        channel: (room && (room.slugifiedName || room.displayName || room.name)) || '',
        private: !!(room && room.type === 'p'),
        roomId: (room && room.id) || '',
    };
    const assoc = new RocketChatAssociationRecord(
        RocketChatAssociationModel.USER,
        `reel-state:${user.id}`,
    );
    await persistence.updateByAssociation(assoc, ctx, true);

    const reels = await fetchRecentReels(read, http);
    const modal = buildModal(modify, file, reels);
    try {
        await modify.getUiController().openModalView(modal, { triggerId }, user);
    } catch (e) {
        app.getLogger().error('reel-state openModalView failed', e);
    }
    return context.getInteractionResponder().successResponse();
}

/** Modal submitted → resolve the reel + call the backend re-host endpoint. */
export async function handleReelStateSubmit(
    app: App,
    context: UIKitViewSubmitInteractionContext,
    read: IRead,
    http: IHttp,
    persistence: IPersistence,
    modify: IModify,
): Promise<IUIKitResponse> {
    const data = context.getInteractionData();
    const { user, view } = data as any;
    if (!view || view.id !== VIEW_ID) {
        return context.getInteractionResponder().successResponse();
    }

    const state: any = view.state || {};
    const typed = String(
        (state[BLOCK_ID] && state[BLOCK_ID][ACTION_REEL_ID]) || '',
    ).trim();
    const selected = String(
        (state[BLOCK_SEL] && state[BLOCK_SEL][ACTION_REEL_SELECT]) || '',
    ).trim();
    let reelId = typed || selected;
    if (/^\d+$/.test(reelId)) {
        reelId = `REEL-${reelId}`;
    }

    // Pull (and clear) the file context stashed on button-click.
    const assoc = new RocketChatAssociationRecord(
        RocketChatAssociationModel.USER,
        `reel-state:${user.id}`,
    );
    let ctx: IFileCtx | null = null;
    try {
        const recs = await read.getPersistenceReader().readByAssociation(assoc);
        ctx = (recs && (recs[0] as any)) || null;
    } catch (e) {
        ctx = null;
    }
    await persistence.removeByAssociation(assoc);

    if (!reelId) {
        return context.getInteractionResponder().viewErrorResponse({
            viewId: VIEW_ID,
            errors: { [BLOCK_ID]: 'Enter a reel id (e.g. REEL-201) or pick one below.' },
        });
    }
    if (!ctx || !ctx.fileId) {
        await notify(
            read,
            modify,
            ctx && ctx.roomId,
            user,
            '⚠️ Lost track of the recording — please click "Set as reel state" again.',
        );
        return context.getInteractionResponder().successResponse();
    }

    const { url, token } = await base(read);
    let ok = false;
    let errMsg = '';
    let resolvedId = reelId;
    try {
        const res = await http.post(`${url}/api/rocketchat/app/attach-recording`, {
            headers: { 'Content-Type': 'application/json' },
            data: {
                token,
                reel_id: reelId,
                file_id: ctx.fileId,
                name: ctx.name,
                channel: ctx.channel,
                private: ctx.private ? 1 : 0,
                user_name: user.username,
            },
        });
        const d = (res && res.data) || {};
        ok = !!d.ok;
        errMsg = d.error || '';
        if (d.reel_id) {
            resolvedId = d.reel_id;
        }
    } catch (e) {
        app.getLogger().error('reel-state attach failed', e);
        errMsg = 'backend unreachable';
    }

    const text = ok
        ? `✅ Set \`${ctx.name}\` as the current reel state for *${resolvedId}*.`
        : `⚠️ Couldn't set the reel state${errMsg ? `: ${errMsg}` : '.'}`;
    await notify(read, modify, ctx.roomId, user, text);

    return context.getInteractionResponder().successResponse();
}
