import {
    IAppAccessors,
    IConfigurationExtend,
    IEnvironmentRead,
    IHttp,
    ILogger,
    IModify,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { SettingType } from '@rocket.chat/apps-engine/definition/settings';
import { UIActionButtonContext } from '@rocket.chat/apps-engine/definition/ui';
import {
    IUIKitInteractionHandler,
    IUIKitResponse,
    UIKitActionButtonInteractionContext,
    UIKitViewSubmitInteractionContext,
} from '@rocket.chat/apps-engine/definition/uikit';
import { ReelCommand } from './ReelCommand';
import {
    handleReelStateButton,
    handleReelStateSubmit,
    REEL_STATE_ACTION_ID,
} from './ReelStateAction';
import { ReelStateCommand } from './ReelStateCommand';

export class ReelCommandApp extends App implements IUIKitInteractionHandler {
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    public async extendConfiguration(
        configuration: IConfigurationExtend,
        environmentRead: IEnvironmentRead,
    ): Promise<void> {
        // Settings: the backend base URL + the shared secret token. These let
        // an admin point the App at the FootageBrain backend without editing code.
        await configuration.settings.provideSetting({
            id: 'reel_backend_url',
            type: SettingType.STRING,
            packageValue: 'http://backend:8000',
            required: true,
            public: false,
            i18nLabel: 'Backend base URL',
            i18nDescription: 'FootageBrain backend base URL reachable from Rocket.Chat (e.g. http://backend:8000 on the same Docker network).',
        });
        await configuration.settings.provideSetting({
            id: 'reel_token',
            type: SettingType.STRING,
            packageValue: '',
            required: true,
            public: false,
            i18nLabel: 'Shared secret token',
            i18nDescription: 'Must match REEL_SLASH_TOKEN in the backend env.',
        });

        await configuration.slashCommands.provideSlashCommand(new ReelCommand(this));
        await configuration.slashCommands.provideSlashCommand(new ReelStateCommand(this));

        // Phase 2: a message-action button to set a chat recording as a reel's
        // "current reel state" — shown in the "•••" menu of every message; it
        // checks for a video upload when clicked (see ReelStateAction).
        await configuration.ui.registerButton({
            actionId: REEL_STATE_ACTION_ID,
            labelI18n: 'reel_state_button',
            context: UIActionButtonContext.MESSAGE_ACTION,
        });
    }

    // ── UIKit interaction handlers (message-action button + modal submit) ──────
    public async executeActionButtonHandler(
        context: UIKitActionButtonInteractionContext,
        read: IRead,
        http: IHttp,
        persistence: IPersistence,
        modify: IModify,
    ): Promise<IUIKitResponse> {
        if (context.getInteractionData().actionId === REEL_STATE_ACTION_ID) {
            return handleReelStateButton(this, context, read, http, persistence, modify);
        }
        return context.getInteractionResponder().successResponse();
    }

    public async executeViewSubmitHandler(
        context: UIKitViewSubmitInteractionContext,
        read: IRead,
        http: IHttp,
        persistence: IPersistence,
        modify: IModify,
    ): Promise<IUIKitResponse> {
        return handleReelStateSubmit(this, context, read, http, persistence, modify);
    }
}
