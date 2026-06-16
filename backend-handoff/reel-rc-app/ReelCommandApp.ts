import {
    IAppAccessors,
    IConfigurationExtend,
    ILogger,
    IEnvironmentRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { ReelCommand } from './ReelCommand';
import { SettingType } from '@rocket.chat/apps-engine/definition/settings';

export class ReelCommandApp extends App {
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
    }
}
