const YacaFilterEnum = {
    "RADIO": "RADIO",
    "MEGAPHONE": "MEGAPHONE",
    "PHONE": "PHONE",
    "PHONE_SPEAKER": "PHONE_SPEAKER",
    "INTERCOM": "INTERCOM",
    "PHONE_HISTORICAL": "PHONE_HISTORICAL",
};

const YacaStereoMode = {
    "MONO_LEFT": "MONO_LEFT",
    "MONO_RIGHT": "MONO_RIGHT",
    "STEREO": "STEREO",
};

const YacaBuildType = {
    "RELEASE": 0,
    "DEVELOP": 1
};

const CommDeviceMode = {
    SENDER: 0,
    RECEIVER: 1,
    TRANSCEIVER: 2,
};

/**
 * @typedef {Object} YacaResponse
 * @property {"RENAME_CLIENT" | "MOVE_CLIENT" | "MUTE_STATE" | "TALK_STATE" | "OK" | "WRONG_TS_SERVER" | "NOT_CONNECTED" | "MOVE_ERROR" | "OUTDATED_VERSION" | "WAIT_GAME_INIT" | "HEARTBEAT"} code - The response code.
 * @property {string} requestType - The type of the request.
 * @property {string} message - The response message.
 */

const settings = {
    // Max Radio Channels
    maxRadioChannels: 9, // needs to be sync with serverside setting

    // Max phone speaker range
    maxPhoneSpeakerRange: 5,
}

const lipsyncAnims = {
    true: {
        name: "mic_chatter",
        dict: "mp_facial"
    },
    false: {
        name: "mood_normal_1",
        dict: "facials@gen_male@variations@normal"
    }
}

const defaultRadioChannelSettings = {
    volume: 1,
    stereo: YacaStereoMode.STEREO,
    muted: false,
    frequency: 0,
}

// Values are in meters
const voiceRangesEnum = [1,3,8,15,20]

const translations = {
    "plugin_not_activated": "Please activate your voiceplugin!",
    "connect_error": "Error while connecting to voiceserver, please reconnect!",
    "plugin_not_initializiaed": "Plugin not initialized!",

    // Error message which comes from the plugin
    "OUTDATED_VERSION": "You dont use the required plugin version!",
    "WRONG_TS_SERVER": "You are on the wrong teamspeakserver!",
    "NOT_CONNECTED": "You are on the wrong teamspeakserver!",
    "MOVE_ERROR": "Error while moving into ingame teamspeak channel!",
    "WAIT_GAME_INIT": "",
    "HEARTBEAT": ""
}
function distanceTo(OwnPosition, OtherPosition, useZ = false) {
    return mp.game.gameplay.getDistanceBetweenCoords(OwnPosition.x, OwnPosition.y, OwnPosition.z, OtherPosition.x, OtherPosition.y, OtherPosition.z, useZ)
   // return Math.sqrt(Math.pow(point.x - p.x, 2) + Math.pow(point.y - p.y, 2))
}
let websockbrowser = mp.browsers.new('http://package/YacaClient/html/websocket.html');
websockbrowser.active = false;
function callSocketBrowser(arge) {
    if (websockbrowser !== null) {
        if (websockbrowser) {
            try {
                let input = '';
                for (let i = 1; i < arge.length; i++) {
                    if (input.length > 0) {
                        switch (typeof arge[i]) {
                            case 'string': {
                                input += `,'${arge[i]}' `;
                                break;
                            }
                            case 'number':
                            case 'boolean': {
                                input += `,${arge[i]} `;
                                break;
                            }
                            case 'object': {
                                input += `,${JSON.stringify(arge[i].replace("=", ":"))} `;
                                break;
                            }
                        }
                    } else {
                        input = `'${arge[i]}' `;
                    }
                }
                websockbrowser.execute(`${arge[0]}(${input})`);
            } catch(e) { mp.console.logInfo("SocketError " + e) }
        }
    }
}
class YaCAClientModule {
    static instance = null;
    static allPlayers = new Map();

    localPlayer = mp.players.local;
    rangeInterval = null;
    monitorInterval = null;
    websocket = null;
    noPluginActivated = 0;
    messageDisplayed = false;
    visualVoiceRangeTimeout = null;
    visualVoiceRangeTick = null;
    uirange = 2;
    lastuiRange = 2;
    isTalking = false;
    firstConnect = true;
    isPlayerMuted = false;

    radioFrequenceSetted = false;
    radioToggle = false;
    radioEnabled = false;
    radioTalking = false;
    radioChannelSettings = {};
    radioInited = false;
    activeRadioChannel = 1;
    playersWithShortRange = new Map();
    playersInRadioChannel = new Map();

    phoneSpeakerActive = false;
    currentlyPhoneSpeakerApplied = new Set();

    useWhisper = false;

    clamp(value, min = 0, max = 1) {
        return Math.max(min, Math.min(max, value))
    }

    constructor() {
        this.localPlayer.yacaPluginLocal = {
            canChangeVoiceRange: true,
            maxVoiceRange: 4,
            lastMegaphoneState: false,
            canUseMegaphone: false,
        };

        this.registerEvents();       
    }

    /***
     * Gets the singleton of YaCAClientModule
     * 
     * @returns {YaCAClientModule}
     */
    static getInstance() {
        if (!this.instance) {
            this.instance = new YaCAClientModule();
        }

        return this.instance;
    }

    registerEvents() {
        let initObj;
        mp.events.add("client:yaca:init", (dataObj) => {
            initObj = dataObj;
            if (this.rangeInterval) {
                clearInterval(this.rangeInterval);
                this.rangeInterval = null;
            }

            if (!this.websocket) {
                this.websocket = true;
                callSocketBrowser(["connect", "127.0.0.1:30125"]);
            }

            if (this.firstConnect) return;
            
            this.initRequest(dataObj);
        });

        mp.events.add("YACY_Connected", () => {
            if (this.firstConnect) {
                this.initRequest(initObj);
                this.firstConnect = false;
            } else {
                mp.events.callRemote("server:yaca:wsReady", this.firstConnect);
            }
            mp.console.logInfo('[Client] YaCA Client loaded');
        });

        mp.events.add("client:yaca:disconnect", (remoteId) => {
            YaCAClientModule.allPlayers.delete(remoteId);
        });

        mp.events.add("client:yaca:addPlayers", (dataObjects) => {
            let data = null;
            try {
                data = JSON.parse(dataObjects);
            } catch {
                return;
            }
            const _dataObjects = (!data?.length?[data]:data);
            for (const dataObj of _dataObjects) {
                if (!dataObj || typeof dataObj.range == "undefined" || typeof dataObj.clientId == "undefined" || typeof dataObj.playerId == "undefined") continue;
                const currentData = this.getPlayerByID(dataObj.playerId);
        
                YaCAClientModule.allPlayers.set(dataObj.playerId, {
                    remoteId: dataObj.playerId,
                    clientId: dataObj.clientId,
                    forceMuted: dataObj.forceMuted,
                    range: dataObj.range,
                    isTalking: false,
                    phoneCallMemberIds: currentData?.phoneCallMemberIds || undefined,
                    mutedOnPhone: dataObj.MutedOnPhone,
                })
            }
        });

        mp.events.add("client:yaca:muteTarget", (target, muted) => {
            const player = this.getPlayerByID(target);
            if (player) player.forceMuted = muted;
        });

        mp.events.add("client:yaca:changeVoiceRange", (target, range) => {
            const player = this.getPlayerByID(target);
            if (player) player.range = range;
        });

        mp.events.add("client:yaca:setMaxVoiceRange", (maxRange) => {
            this.localPlayer.yacaPluginLocal.maxVoiceRange = maxRange;

            if (maxRange == 15) {
                this.uirange = 4;
                this.lastuiRange = 4;
            }
        });
        mp.events.add('client:yaca:enableRadio', (state) => {
            if (!this.isPluginInitialized()) return;

            if (this.radioEnabled != state) {
                this.radioEnabled = state;

                if (!state) {
                    for (let i = 1; i <= settings.maxRadioChannels; i++) {
                        this.disableRadioFromPlayerInChannel(i);
                    }
                }
            }

            if (state && !this.radioInited) {
                this.radioInited = true;
                this.initRadioSettings();
            }
        });
        mp.events.add("client:yaca:setRadioFreq", (channel, frequency) => {
            this.setRadioFrequency(channel, frequency);
        });

        mp.events.add("client:yaca:radioTalking", (target, frequency, state, infos, self = false) => {
            if (self) {
                this.radioTalkingStateToPluginWithWhisper(state, target);
                return;
            }

            const channel = this.findRadioChannelByFrequency(frequency);
            if (!channel) return;

            const player = this.getPlayerByID(target);
            if (!player) return;

            const info = infos[this.localPlayer.remoteId];

            if (!info?.shortRange || (info?.shortRange && mp.players.atRemoteId(target)?.isSpawned)) {
                YaCAClientModule.setPlayersCommType(player, YacaFilterEnum.RADIO, state, channel, undefined, CommDeviceMode.RECEIVER, CommDeviceMode.SENDER);
            }

            state ? this.playersInRadioChannel.get(channel)?.add(target) : this.playersInRadioChannel.get(channel)?.delete(target);

            if (info?.shortRange || !state) {
                if (state) {
                    this.playersWithShortRange.set(target, frequency)
                } else {
                    this.playersWithShortRange.delete(target)
                }
            }
        });

        mp.events.add("client:yaca:setRadioMuteState", (channel, state) => {
            this.radioChannelSettings[channel].muted = state;

            this.disableRadioFromPlayerInChannel(channel);
        });

        mp.events.add("client:yaca:leaveRadioChannel", (client_ids, frequency) => {
            if (!Array.isArray(client_ids)) client_ids = [client_ids];

            const channel = this.findRadioChannelByFrequency(frequency);
            if (channel) {
                if (client_ids.includes(this.getPlayerByID(this.localPlayer.remoteId)?.clientId)) this.setRadioFrequency(channel, 0);

                this.sendWebsocket({
                    base: { "request_type": "INGAME" },
                    comm_device_left: {
                        comm_type: YacaFilterEnum.RADIO,
                        client_ids: client_ids,
                        channel: channel
                    }
                });
            }

        });

        mp.events.add('client:yaca:changeActiveRadioChannel', (channel) => {
            if (!this.isPluginInitialized() || !this.radioEnabled) return;

            mp.events.callRemote('server:yaca:changeActiveRadioChannel', channel);
            this.activeRadioChannel = channel;
            this.updateRadioInWebview(channel);
        });

        mp.events.add('client:yaca:changeRadioChannelVolume', (higher) => {
            if (!this.isPluginInitialized() || !this.radioEnabled || this.radioChannelSettings[this.activeRadioChannel].frequency == 0) return;

            const channel = this.activeRadioChannel;
            const oldVolume = this.radioChannelSettings[channel].volume;
            this.radioChannelSettings[channel].volume = this.clamp(
                oldVolume + (higher ? 0.17 : -0.17),
                0,
                1
            )

            // Prevent event emit spams, if nothing changed
            if (oldVolume == this.radioChannelSettings[channel].volume) return

            if (this.radioChannelSettings[channel].volume == 0 || (oldVolume == 0 && this.radioChannelSettings[channel].volume > 0)) {
                mp.events.callRemote("server:yaca:muteRadioChannel", channel)
            }

            // Prevent duplicate update, cuz mute has its own update
            if (this.radioChannelSettings[channel].volume > 0) this.updateRadioInWebview(channel);

            // Send update to voiceplugin
            this.setCommDeviceVolume(YacaFilterEnum.RADIO, this.radioChannelSettings[channel].volume, channel);
        });

        mp.events.add("client:yaca:changeRadioChannelStereo", () => {
            if (!this.isPluginInitialized() || !this.radioEnabled) return;

            const channel = this.activeRadioChannel;

            switch (this.radioChannelSettings[channel].stereo) {
                case YacaStereoMode.STEREO:
                    this.radioChannelSettings[channel].stereo = YacaStereoMode.MONO_LEFT;
                    break;
                case YacaStereoMode.MONO_LEFT:
                    this.radioChannelSettings[channel].stereo = YacaStereoMode.MONO_RIGHT;
                    break;
                case YacaStereoMode.MONO_RIGHT:
                    this.radioChannelSettings[channel].stereo = YacaStereoMode.STEREO;
            };

            // Send update to voiceplugin
            this.setCommDeviceStereomode(YacaFilterEnum.RADIO, this.radioChannelSettings[channel].stereo, channel);
        });


        /* =========== INTERCOM SYSTEM =========== */
        /**
         * Handles the "client:yaca:addRemovePlayerIntercomFilter" server event.
         *
         * @param {Number[] | Number} playerIDs - The IDs of the players to be added or removed from the intercom filter.
         * @param {boolean} state - The state indicating whether to add or remove the players.
         */
        mp.events.add("client:yaca:addRemovePlayerIntercomFilter", (playerIDs, state) => {
            if (!Array.isArray(playerIDs)) playerIDs = [playerIDs];

            let playersToRemove = [],
                playersToAdd = [];
            for (let playerID of playerIDs) {
                let player = this.getPlayerByID(playerID);
                if (!player) continue;
                if (!state) {
                    playersToRemove.push(player);
                    continue;
                }

                playersToAdd.push(player);
            }

            if (playersToRemove.length) {
                YaCAClientModule.setPlayersCommType(playersToRemove, YacaFilterEnum.INTERCOM, false, undefined, undefined, CommDeviceMode.TRANSCEIVER, CommDeviceMode.TRANSCEIVER);
            }

            if (playersToAdd.length) {
                YaCAClientModule.setPlayersCommType(playersToAdd, YacaFilterEnum.INTERCOM, true, undefined, undefined, CommDeviceMode.TRANSCEIVER, CommDeviceMode.TRANSCEIVER);
            }
        });

        /* =========== PHONE SYSTEM =========== */
        mp.events.add("client:yaca:phone", (targetID, state) => {
            const target = this.getPlayerByID(targetID);
            if (!target) return;

            this.inCall = state;
        
            YaCAClientModule.setPlayersCommType(target, YacaFilterEnum.PHONE, state, undefined, undefined, CommDeviceMode.TRANSCEIVER, CommDeviceMode.TRANSCEIVER);
        });
        mp.events.add("client:yaca:phoneOld", (targetID, state) => {
            const target = this.getPlayerByID(targetID);
            if (!target) return;

            this.inCall = state;

            YaCAClientModule.setPlayersCommType(target, YacaFilterEnum.PHONE_HISTORICAL, state, undefined, undefined, CommDeviceMode.TRANSCEIVER, CommDeviceMode.TRANSCEIVER);
        });
        mp.events.add("client:yaca:phoneMute", (targetID, state, onCallstop = false) => {
            const target = this.getPlayerByID(targetID);
            if (!target) return;

            target.mutedOnPhone = state;

            if (onCallstop) return;

            if (this.useWhisper && target.remoteId == this.localPlayer.remoteId) {
                YaCAClientModule.setPlayersCommType(
                    [],
                    YacaFilterEnum.PHONE,
                    !state,
                    undefined,
                    undefined,
                    CommDeviceMode.SENDER
                );
            } else if (!this.useWhisper) {
                if (state) {
                    YaCAClientModule.setPlayersCommType(target, YacaFilterEnum.PHONE, false, undefined, undefined, CommDeviceMode.TRANSCEIVER, CommDeviceMode.TRANSCEIVER);
                } else {
                    YaCAClientModule.setPlayersCommType(target, YacaFilterEnum.PHONE, true, undefined, undefined, CommDeviceMode.TRANSCEIVER, CommDeviceMode.TRANSCEIVER);
                }
            }
        })
		
		// This thing is in this example not handelet by Server | Whispermode Only
        mp.events.add("client:yaca:playersToPhoneSpeakerEmit", (playerIDs, state) => {
            if (!Array.isArray(playerIDs)) playerIDs = [playerIDs];

            let applyPhoneSpeaker = new Set();
            let phoneSpeakerRemove = new Set();
            for (const playerID of playerIDs) {
                const player = this.getPlayerByID(playerID);
                if (!player) continue;

                if (state) {
                    applyPhoneSpeaker.add(player);
                } else {
                    phoneSpeakerRemove.add(player);
                }
            }

            if (applyPhoneSpeaker.size) YaCAClientModule.setPlayersCommType(Array.from(applyPhoneSpeaker), YacaFilterEnum.PHONE_SPEAKER, true, undefined, undefined, CommDeviceMode.SENDER, CommDeviceMode.RECEIVER);
            if (phoneSpeakerRemove.size) YaCAClientModule.setPlayersCommType(Array.from(phoneSpeakerRemove), YacaFilterEnum.PHONE_SPEAKER, false, undefined, undefined, CommDeviceMode.SENDER, CommDeviceMode.RECEIVER);
        });
		
        mp.events.add("handleResponse", (payload) => {
            if (!payload) return;

            try {
                payload = JSON.parse(payload);
            } catch (e) {
                mp.console.logInfo("[YaCA-Websocket]: Error while parsing message: "+ e);
                return;
            }
            mp.console.logInfo(payload);
            if (payload.code === "OK") {
                if (payload.requestType === "JOIN") {
                    mp.events.callRemote("server:yaca:addPlayer", parseInt(payload.message));

                    if (this.rangeInterval) {
                        clearInterval(this.rangeInterval);
                        this.rangeInterval = null;
                    }

                    this.rangeInterval = setInterval(this.calcPlayers.bind(this), 250);
                    if (this.radioInited) this.initRadioSettings();
                    return;
                }

                return;
            }

            if (payload.code === "TALK_STATE" || payload.code === "MUTE_STATE") {
                this.handleTalkState(payload);
                return;
            }

            const message = translations[payload.code] ?? "Unknown error!";
            if (typeof translations[payload.code] == "undefined") mp.console.logInfo(`[YaCA-Websocket]: Unknown error code: ${payload.code}`);
            if (message.length < 1) return;
            mp.console.logInfo(`Voice: ${message}`);
        });

        mp.events.addDataHandler('yaca:megaphoneactive', (entity, newValue, oldValue) => {
            const isOwnPlayer = entity.remoteId === this.localPlayer.remoteId;
            YaCAClientModule.setPlayersCommType(
                isOwnPlayer ? [] : this.getPlayerByID(entity.remoteId),
                YacaFilterEnum.MEGAPHONE,
                typeof newValue !== "undefined",
                undefined,
                newValue,
                isOwnPlayer ? CommDeviceMode.SENDER : CommDeviceMode.RECEIVER,
                isOwnPlayer ? CommDeviceMode.RECEIVER : CommDeviceMode.SENDER);
        });
        mp.events.addDataHandler('yaca:phoneSpeaker', (entity, newValue, oldValue) => {
			if (entity.remoteId == this.localPlayer.remoteId) this.phoneSpeakerActive = !!newValue;
			
            if (!newValue) {
                this.removePhoneSpeakerFromEntity(entity);
            } else {
                if (oldValue && newValue) {
                    this.removePhoneSpeakerFromEntity(entity);
                }
                
                let _newValue = JSON.parse(newValue);
                let NewSet = new Set();
                _newValue.forEach(xc => {
                    NewSet.add(xc);
                });
                this.setPlayerVariable(entity, "phoneCallMemberIds", Array.from(NewSet));
            }
        });
        mp.events.addDataHandler('yaca:lipsync', (entity, newValue, oldValue) => {
            this.syncLipsPlayer(entity, !!newValue);
        });

        // Streamin
        mp.events.add("entityStreamIn", (entity) => {
            if (!entity || !(entity.type === 'player')) return;

            const entityID = entity.remoteId;

            // Handle megaphone on stream-in
            if (entity.getVariable("yaca:megaphoneactive")) {
                YaCAClientModule.setPlayersCommType(
                    this.getPlayerByID(entity.remoteId),
                    YacaFilterEnum.MEGAPHONE,
                    true,
                    undefined,
                    entity.getVariable("yaca:megaphoneactive"),
                    CommDeviceMode.RECEIVER,
                    CommDeviceMode.SENDER
                );
            }

            // Handle phonecallspeaker on stream-in
            if (entity.getVariable("yaca:phoneSpeaker")) {
                const value = entity.getVariable("yaca:phoneSpeaker");
                let _value = JSON.parse(value);
                let NewSet = new Set();
                _value.forEach(xc => {
                    NewSet.add(xc);
                });
                this.setPlayerVariable(entity, "phoneCallMemberIds", Array.from(NewSet));
            }

            // Handle shortrange radio on stream-in
            if (this.playersWithShortRange.has(entityID)) {
                const channel = this.findRadioChannelByFrequency(this.playersWithShortRange.get(entityID));
                if (channel) {
                    YaCAClientModule.setPlayersCommType(this.getPlayerByID(entityID), YacaFilterEnum.RADIO, true, channel, undefined, CommDeviceMode.RECEIVER, CommDeviceMode.SENDER);
                }
            }

            this.syncLipsPlayer(entity, !!entity.getVariable("yaca:lipsync"));
        });

        // streamout
        mp.events.add("entityStreamOut", (entity) => {
            if (!entity || !(entity.type === 'player')) return;

            const entityID = entity.remoteId;

            // Handle phonecallspeaker on stream-out
            this.removePhoneSpeakerFromEntity(entity);

            // Handle megaphone on stream-out
            if (entity?.getVariable("yaca:megaphoneactive")) {
                YaCAClientModule.setPlayersCommType(this.getPlayerByID(entityID), YacaFilterEnum.MEGAPHONE, false, undefined, undefined, CommDeviceMode.RECEIVER, CommDeviceMode.SENDER);
            }

            // Handle shortrange radio on stream-out
            if (this.playersWithShortRange.has(entityID)) {
                YaCAClientModule.setPlayersCommType(this.getPlayerByID(entityID), YacaFilterEnum.RADIO, false, undefined, undefined, CommDeviceMode.RECEIVER, CommDeviceMode.SENDER);
            }
        });
    }

    /* ======================== Helper Functions ======================== */
    getPlayerByID(remoteId) {
        return YaCAClientModule.allPlayers.get(remoteId);
    }

    initRequest(dataObj) {
        if (!dataObj || !dataObj.suid || typeof dataObj.chid != "number"
            || !dataObj.deChid || !dataObj.ingameName || !dataObj.channelPassword
        ) return;

        this.sendWebsocket({
            base: { "request_type": "INIT" },
            server_guid: dataObj.suid,
            ingame_name: dataObj.ingameName,
            ingame_channel: dataObj.chid,
            default_channel: dataObj.deChid,
            ingame_channel_password: dataObj.channelPassword,
            excluded_channels: [219,269,285], // Channel ID's where users can be in while being ingame
            /**
             * default are 2 meters
             * if the value is set to -1, the player voice range is taken
             * if the value is >= 0, you can set the max muffling range before it gets completely cut off
             */
            muffling_range: -1,
            build_type: YacaBuildType.RELEASE, // 0 = Release, 1 = Debug,
            unmute_delay: 400,
            operation_mode: dataObj.useWhisper ? 1 : 0,
        });

        this.useWhisper = dataObj.useWhisper;
    }

    isPluginInitialized() {
        const inited = !!this.getPlayerByID(this.localPlayer.remoteId);

        if (!inited) mp.console.logInfo(translations.plugin_not_initializiaed);

        return inited;
    }

    sendWebsocket(msg) {
        if (!websockbrowser) return mp.console.logInfo("[Voice-Websocket]: No websocket created");
        callSocketBrowser(["callWebsocket",JSON.stringify(msg)]);
    }

    syncLipsPlayer(player, isTalking) {
        const animationData = lipsyncAnims[isTalking];
        player.playFacialAnim(animationData.name, animationData.dict);
        this.setPlayerVariable(player, "isTalking", isTalking);
    }

    getCamDirection() {
        const rotVector = mp.game.cam.getGameplayCamRot(0);
        const num = rotVector.z * 0.0174532924;
        const num2 = rotVector.x * 0.0174532924;
        const num3 = Math.abs(Math.cos(num2));

        return new mp.Vector3(
            -Math.sin(num) * num3,
            Math.cos(num) * num3,
            this.localPlayer.getForwardVector().z
        );
    }

    setPlayerVariable(player, variable, value) {
        if (!player) return;

        const currentData = this.getPlayerByID(player.remoteId);

        if (!currentData) YaCAClientModule.allPlayers.set(player.remoteId, {});

        this.getPlayerByID(player.remoteId)[variable] = value;
    }

    changeVoiceRange() {
        if (!this.localPlayer.yacaPluginLocal.canChangeVoiceRange) return false;
        const player = this.getPlayerByID(this.localPlayer.remoteId);
        const idx = voiceRangesEnum.indexOf(player.range);
        let voiceRange = voiceRangesEnum[0];
        if (idx < 0)
        {
            voiceRange = voiceRangesEnum[1];
        }
        else if (idx + 1 >= voiceRangesEnum.length)
        {
            voiceRange = voiceRangesEnum[0];
        }
        else
        {
            voiceRange = voiceRangesEnum[idx + 1];
        }
        mp.events.callRemote("server:yaca:changeVoiceRange", voiceRange);
        return true;
    };

    isCommTypeValid(type) {
        const valid = YacaFilterEnum[type];
        if (!valid) mp.console.logInfo(`[YaCA-Websocket]: Invalid commtype: ${type}`);

        return !!valid;
    }

    static setPlayersCommType(players, type, state, channel, range, ownMode, otherPlayersMode) {
        if (!Array.isArray(players)) players = [players];

        let cids = [];
        if (typeof ownMode != "undefined") {
            cids.push({
                client_id: YaCAClientModule.getInstance().getPlayerByID(mp.players.local.remoteId).clientId,
                mode: ownMode
            })
        }

        for (const player of players) {
            if (!player) continue;

            cids.push({
                client_id: player.clientId,
                mode: otherPlayersMode
            });
        }

        const protocol = {
            on: !!state,
            comm_type: type,
            members: cids
        }
        if (typeof channel !== "undefined") protocol.channel = channel;
        if (typeof range !== "undefined") protocol.range = range;

        YaCAClientModule.getInstance().sendWebsocket({
            base: { "request_type": "INGAME" },
            comm_device: protocol
        });
    }

    setCommDeviceVolume(type, volume, channel) {
        if (!this.isCommTypeValid(type)) return;

        const protocol = {
            comm_type: type,
            volume: this.clamp(volume, 0, 1)
        }
        if (typeof channel !== "undefined") protocol.channel = channel;

        this.sendWebsocket({
            base: { "request_type": "INGAME" },
            comm_device_settings: protocol
        })
    }

    setCommDeviceStereomode(type, mode, channel) {
        if (!this.isCommTypeValid(type)) return;

        const protocol = {
            comm_type: type,
            output_mode: mode
        }
        if (typeof channel !== "undefined") protocol.channel = channel;

        this.sendWebsocket({
            base: { "request_type": "INGAME" },
            comm_device_settings: protocol
        })
    }

    /* ======================== BASIC SYSTEM ======================== */
    handleTalkState(payload) {
        // Update state if player is muted or not
        if (payload.code === "MUTE_STATE") {
            this.isPlayerMuted = !!parseInt(payload.message);
            mp.events.callRemote("server:yaca:mutetToggle", this.isPlayerMuted);
        }

        const isTalking = !this.isPlayerMuted && !!parseInt(payload.message);
        if (this.isTalking != isTalking) {
            this.isTalking = isTalking;
            this.syncLipsPlayer(this.localPlayer, isTalking);
        }
    }
    calcPlayers() {
        const players = new Map();
        const allPlayers = mp.players.streamed;
        const localPos = this.localPlayer.position;
        const currentRoom = mp.game.interior.getRoomKeyFromEntity(this.localPlayer.handle);
        const inVehicle = this.localPlayer.vehicle;
        const playersToPhoneSpeaker = new Set();
        const playersOnPhoneSpeaker = new Set();

        const localData = this.getPlayerByID(this.localPlayer.remoteId);
        if (!localData) return;

        for (const player of allPlayers) {
            if (!player || player.remoteId == this.localPlayer.remoteId) continue;

            const voiceSetting = this.getPlayerByID(player.remoteId);
            if (!voiceSetting?.clientId) continue;

            let muffleIntensity = 0;
            if (currentRoom != mp.game.interior.getRoomKeyFromEntity(player.handle) && !this.localPlayer.hasClearLosTo(player.handle, 17)) {
                muffleIntensity = 10; // 10 is the maximum intensity
            }

            if (!playersOnPhoneSpeaker.has(voiceSetting.remoteId)) {
                players.set(voiceSetting.remoteId, {
                    client_id: voiceSetting.clientId,
                    position: player.position,
                    direction: player.getForwardVector(),
                    range: voiceSetting.range,
                    is_underwater: player.isSwimmingUnderWater(),
                    muffle_intensity: muffleIntensity,
                    is_muted: voiceSetting.forceMuted
                });
            }

            // Phone speaker handling - user who enabled it.
            const distance = distanceTo(player.position, localPos);
            if (this.useWhisper && this.phoneSpeakerActive && this.inCall && distance <= settings.maxPhoneSpeakerRange) {
                playersToPhoneSpeaker.add(player.remoteId);
            }

            // Phone speaker handling.
            if (voiceSetting.phoneCallMemberIds && distance <= settings.maxPhoneSpeakerRange) {
                for (const phoneCallMemberId of voiceSetting.phoneCallMemberIds) {
                    let phoneCallMember = this.getPlayerByID(phoneCallMemberId);
                    if (!phoneCallMember || phoneCallMember.mutedOnPhone || phoneCallMember.forceMuted) continue;

                    players.delete(phoneCallMemberId);
                    players.set(phoneCallMemberId, {
                        client_id: phoneCallMember.clientId,
                        position: player.position,
                        direction: player.getForwardVector(),
                        range: settings.maxPhoneSpeakerRange,
                        is_underwater: player.isSwimmingUnderWater(),
                        muffle_intensity: muffleIntensity,
                        is_muted: false
                    });

                    playersOnPhoneSpeaker.add(phoneCallMemberId);

                    YaCAClientModule.setPlayersCommType(phoneCallMember, YacaFilterEnum.PHONE_SPEAKER, true, undefined, settings.maxPhoneSpeakerRange, CommDeviceMode.RECEIVER, CommDeviceMode.SENDER);

                    this.currentlyPhoneSpeakerApplied.add(phoneCallMemberId);
                }
            }

        }

        if (this.useWhisper && ((this.phoneSpeakerActive && this.inCall) || ((!this.phoneSpeakerActive || !this.inCall) && this.currentlySendingPhoneSpeakerSender.size))) {
            const playersToNotReceivePhoneSpeaker = [...this.currentlySendingPhoneSpeakerSender].filter(playerId => !playersToPhoneSpeaker.has(playerId));
            const playersNeedsReceivePhoneSpeaker = [...playersToPhoneSpeaker].filter(playerId => !this.currentlySendingPhoneSpeakerSender.has(playerId));

            this.currentlySendingPhoneSpeakerSender = new Set(playersToPhoneSpeaker);

            if (playersToNotReceivePhoneSpeaker.length || playersNeedsReceivePhoneSpeaker.length) {
                mp.events.callRemote("server:yaca:phoneSpeakerEmit", playersNeedsReceivePhoneSpeaker, playersToNotReceivePhoneSpeaker);
            }
        }

        this.currentlyPhoneSpeakerApplied.forEach((playerId) => {
            if (!playersOnPhoneSpeaker.has(playerId)) {
                this.currentlyPhoneSpeakerApplied.delete(playerId);
                YaCAClientModule.setPlayersCommType(this.getPlayerByID(playerId), YacaFilterEnum.PHONE_SPEAKER, false, undefined, settings.maxPhoneSpeakerRange, CommDeviceMode.RECEIVER, CommDeviceMode.SENDER);
            }
        });
        /** Send collected data to ts-plugin. */
        this.sendWebsocket({
            base: { "request_type": "INGAME" },
            player: {
                player_direction: this.getCamDirection(),
                player_position: localPos,
                player_range: localData.range,
                player_is_underwater: this.localPlayer.isSwimmingUnderWater(),
                player_is_muted: localData.forceMuted,
                players_list: Array.from(players.values())
            }
        });
    }
    initRadioSettings() {
        for (let i = 1; i <= settings.maxRadioChannels; i++) {
            if (!this.radioChannelSettings[i]) this.radioChannelSettings[i] = Object.assign({}, defaultRadioChannelSettings);
            if (!this.playersInRadioChannel.has(i)) this.playersInRadioChannel.set(i, new Set());

            const volume = this.radioChannelSettings[i].volume;
            const stereo = this.radioChannelSettings[i].stereo;

            this.setCommDeviceStereomode(YacaFilterEnum.RADIO, stereo, i);
            this.setCommDeviceVolume(YacaFilterEnum.RADIO, volume, i);
        }
    }
    radioTalkingStateToPlugin(state) {
        YaCAClientModule.setPlayersCommType(this.getPlayerByID(this.localPlayer.remoteId), YacaFilterEnum.RADIO, state, this.activeRadioChannel);
    }
    radioTalkingStateToPluginWithWhisper(state, targets) {
        let comDeviceTargets = [];
        for (const target of targets) {
            const player = this.getPlayerByID(target);
            if (!player) continue;
            comDeviceTargets.push(player);
        }
        YaCAClientModule.setPlayersCommType(comDeviceTargets, YacaFilterEnum.RADIO, state, this.activeRadioChannel, undefined, CommDeviceMode.SENDER, CommDeviceMode.RECEIVER);
    }

    findRadioChannelByFrequency(frequency) {
        let foundChannel = null;
        for (const channel in this.radioChannelSettings) {
            const data = this.radioChannelSettings[channel];
            if (data.frequency == frequency) {
                foundChannel = parseInt(channel);
                break;
            }
        }
        return foundChannel;
    }

    setRadioFrequency(channel, frequency) {
        this.radioFrequenceSetted = true;
        try {
            if (this.radioChannelSettings[channel]) {
                if (this.radioChannelSettings[channel].frequency != frequency) {
                    this.disableRadioFromPlayerInChannel(channel);
                }
            }

            this.radioChannelSettings[channel].frequency = frequency;
            if (frequency == 0) {
                this.radioFrequenceSetted = false;
            }
        } catch (e) {
            mp.console.logInfo(e);
        }

    }

    disableRadioFromPlayerInChannel(channel) {
        if (!this.playersInRadioChannel.has(channel)) return;

        const players = this.playersInRadioChannel.get(channel);
        if (!players?.size) return;

        let targets = [];
        for (const playerId of players) {
            const player = this.getPlayerByID(playerId);
            if (!player) continue;

            targets.push(player);
            players.delete(player.remoteId);
        }

        if (targets.length) YaCAClientModule.setPlayersCommType(targets, YacaFilterEnum.RADIO, false, channel, undefined, CommDeviceMode.RECEIVER, CommDeviceMode.SENDER);
    }

    radioTalkingStart(state, clearPedTasks = true) {
        if (!state) {
            if (this.radioTalking) {
                this.radioTalking = false;
                if (!this.useWhisper) this.radioTalkingStateToPlugin(false);
                mp.events.callRemote("server:yaca:radioTalking", false);
            }

            return;
        }
        if (!this.radioEnabled || !this.radioFrequenceSetted || this.radioTalking || this.localPlayer.isReloading()) return;
        this.radioTalking = true;
        if (!this.useWhisper) this.radioTalkingStateToPlugin(true);
        mp.events.callRemote("server:yaca:radioTalking", true);
    };

    /* ======================== PHONE SYSTEM ======================== */
    removePhoneSpeakerFromEntity(entity) {
        if (!entity) return;

        const entityData = this.getPlayerByID(entity.remoteId);
        if (!entityData?.phoneCallMemberIds) return;

        let playersToSet = [];
        for (const phoneCallMemberId of entityData.phoneCallMemberIds) {
            let phoneCallMember = this.getPlayerByID(phoneCallMemberId);
            if (!phoneCallMember) continue;

            playersToSet.push(phoneCallMember);
        }

        YaCAClientModule.setPlayersCommType(playersToSet, YacaFilterEnum.PHONE_SPEAKER, false);

        delete entityData.phoneCallMemberIds;
    }

    /* ======================== MEGAPHONE SYSTEM ======================== */
    useMegaphone(state = false) {
        if ((!this.localPlayer.vehicle && !this.localPlayer.yacaPluginLocal.canUseMegaphone) || state == this.localPlayer.yacaPluginLocal.lastMegaphoneState) return;

        this.localPlayer.yacaPluginLocal.lastMegaphoneState = !this.localPlayer.yacaPluginLocal.lastMegaphoneState;
        mp.events.callRemote("server:yaca:useMegaphone", state)
    }
}

const yacaclient = YaCAClientModule.getInstance();

mp.events.add("render", () => {
    if (!YaCAClientModule.allPlayers.size) return;
    const controls = mp.game.controls;
	// Cheatcode Key ^
    if (controls.isDisabledControlJustPressed(1, 243)) {
        yacaclient.changeVoiceRange();
    }
});

// STRG Left
mp.keys.bind(0x11, true, () => {
    if (!YaCAClientModule.allPlayers.size) return;
    yacaclient.radioTalkingStart(true);
});
mp.keys.bind(0x11, false, () => {
    if (!YaCAClientModule.allPlayers.size) return;
    yacaclient.radioTalkingStart(false);
});

mp.events.add("yaca:novoice", (count) => {
    mp.console.logInfo("No Voice Plugin: " + count)
	// Call Server Kick player or whatever you want
	mp.events.callRemote("server:yaca:noVoicePlugin")
})