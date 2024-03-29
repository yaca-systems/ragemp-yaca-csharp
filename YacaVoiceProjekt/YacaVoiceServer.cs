﻿using GTANetworkAPI;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using System.Runtime.InteropServices;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace YacaVoice
{
    #region Settings Models
    public class voiceSettings
    {
        public int voiceRange { get; set; } = 3;
        public bool voiceFirstConnect { get; set; } = false;
        public int maxVoiceRangeInMeter { get; set; } = 20;
        public bool forceMuted { get; set; } = false;
        public string ingameName { get; set; } = "";
        public bool mutedOnPhone { get; set; } = false;
        public List<int> inCallWith { get; set; } = new List<int>();
    }
    public class radioSettings
    {
        public bool activated { get; set; } = false;
        public int currentChannel { get; set; } = 1;
        public bool hasLong { get; set; } = false;
        public Dictionary<int, string> frequencies { get; set; } = new Dictionary<int, string>();
    }
    public class voicePlugin
    {
        public string clientId { get; set; } // TS Client ID
        public bool forceMuted { get; set; } = false; // 
        public int range { get; set; } = 3; // Default 3 Meter 
        public int playerId { get; set; } // Player RemoteId
        public bool mutedOnPhone { get; set; } = false; //
    }
    #endregion

    #region VoiceClient Model
    public class YacaVoiceClient
    {
        public Player Player { get; set; }
        public voiceSettings voiceSettings { get; set; } = new voiceSettings();
        public radioSettings radioSettings { get; set; } = new radioSettings();
        public voicePlugin voicePlugin { get; set; }

        public YacaVoiceClient(Player player, string teamSpeakName, int voiceRange)
        {
            Player = player;
            voiceSettings.ingameName = teamSpeakName;
            voiceSettings.voiceRange = voiceRange;
        }
        internal void TriggerEvent(string eventName, params object[] args) => Player.TriggerEvent(eventName, args);
    }
    #endregion

    #region Funk / Radio Models
    public class RadioMemberInfo
    {
        public bool muted { get; set; } = false;
    }
    public class RadioInfos
    {
        public bool shortRange { get; set; } = false;
    }
    public class YacaRadioChannel
    {
        public string channelName { get; set; } // Frequenz
        internal YacaRadioChannelMember[] Members => this._members.ToArray();
        private List<YacaRadioChannelMember> _members = new List<YacaRadioChannelMember>();

        #region Methoden
        internal bool IsMember(YacaVoiceClient voiceClient)
        {
            return this.Members.Any(m => m.VoiceClient == voiceClient);
        }
        internal void AddMember(YacaVoiceClient voiceClient, RadioMemberInfo info)
        {
            this._members.Add(new YacaRadioChannelMember
            {
                memberInfo = info,
                VoiceClient = voiceClient
            });
        }
        internal void RemoveMember(YacaVoiceClient voiceClient)
        {
            var membertoremove = this.Members.FirstOrDefault(x => x.VoiceClient == voiceClient);
            this._members.Remove(membertoremove);
        }
        internal YacaRadioChannelMember GetRadioMember(YacaVoiceClient voiceClient)
        {
            return Members.FirstOrDefault(m => m.VoiceClient == voiceClient);
        }
        #endregion

    }
    public class YacaRadioChannelMember
    {
        public YacaVoiceClient VoiceClient { get; set; }
        public RadioMemberInfo memberInfo { get; set; } = new RadioMemberInfo();
    }
    #endregion

    public class YacaVoiceServer : Script
    {
        #region Propertys
        public static YacaVoiceServer Instance { get; private set; }
        public int maxRadioChannels { get; private set; } = 9;
        public string UNIQUE_SERVER_ID { get; private set; } = "";
        public int CHANNEL_ID { get; private set; } = 2; // Ingame TS Channel ID
        public string CHANNEL_PASSWORD { get; private set; } = "";
        public int DEFAULT_CHANNEL_ID { get; private set; } = 1; // AFK / Eingangshalle
        public bool USE_WHISPER { get; private set; } = false;

        public YacaVoiceClient[] VoiceClients => _voiceClients.Values.ToArray();
        private Dictionary<Player, YacaVoiceClient> _voiceClients = new Dictionary<Player, YacaVoiceClient>();

        public YacaRadioChannel[] RadioChannels => this._radioChannels.ToArray();
        private List<YacaRadioChannel> _radioChannels = new List<YacaRadioChannel>();

        #endregion

        #region CTOR
        public YacaVoiceServer()
        {
            Instance = this;
        }
        #endregion

        #region Basics
        public static List<string> VoiceNames = new List<string>();

        [ServerEvent(Event.ResourceStart)]
        public void OnResourceStart()
        {
            UNIQUE_SERVER_ID = NAPI.Resource.GetSetting<string>(this, "ServerUniqueIdentifier");
            CHANNEL_ID = NAPI.Resource.GetSetting<string>(this, "IngameChannel").GetNumbersInt();
            CHANNEL_PASSWORD = NAPI.Resource.GetSetting<string>(this, "IngameChannelPassword");
            DEFAULT_CHANNEL_ID = NAPI.Resource.GetSetting<string>(this, "DefaultChannel").GetNumbersInt();
        }

        public void ConnectToVoice(Player client)
        {
            try
            {
                Task.Run(async () =>
                {
                    Action action = () =>
                    {
                        if (!client.IsLoggedIn()) return;
                        client.setVoiceName();
                        YacaVoiceClient voiceClient;
                        client.SetSharedData("VOICE_RANGE", 3);

                        VoiceNames.Add(client.getVoiceName());
                        lock (this._voiceClients)
                        {
                            if (this._voiceClients.TryGetValue(client, out voiceClient))
                                this._voiceClients.Remove(client);
                            voiceClient = new YacaVoiceClient(client, client.getVoiceName(), 3);
                            voiceClient.voiceSettings.voiceFirstConnect = true;
                            this._voiceClients.Add(client, voiceClient);
                        }
                        var data = new Dictionary<string, dynamic>();
                        data["suid"] = UNIQUE_SERVER_ID;
                        data["chid"] = CHANNEL_ID;
                        data["deChid"] = DEFAULT_CHANNEL_ID;
                        data["channelPassword"] = CHANNEL_PASSWORD;
                        data["ingameName"] = voiceClient.voiceSettings.ingameName;
                        data["useWhisper"] = USE_WHISPER;
                        client.TriggerEvent("client:yaca:init", data);
                    };
                    await RunSafeFromAsyncContext(action);
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine("VoiceError: " + ex.ToString());
            }
        }

        [ServerEvent(Event.PlayerDisconnected)]
        public void OnPlayerDisconnected(Player client, DisconnectionType disconnectionType = DisconnectionType.Left, string reason = "")
        {
            client.TriggerEvent("exitVoice");
            try
            {
                Task.Run(async () =>
                {
                    Action action = () =>
                    {
                        var remoteid = client.Id;

                        YacaVoiceClient voiceClient;

                        lock (this._voiceClients)
                        {
                            if (!this._voiceClients.TryGetValue(client, out voiceClient))
                                return;
                            this._voiceClients.Remove(client);
                        }

                        var allRadios = this.RadioChannels.ToList();

                        foreach (var item in allRadios)
                        {
                            if (item.IsMember(voiceClient))
                            {
                                item.RemoveMember(voiceClient);
                                if (item.Members.Length <= 0)
                                {
                                    this._radioChannels.Remove(item);
                                }
                            }
                        }

                        if (voiceClient.voiceSettings != null)
                        {
                            if (VoiceNames.Contains(voiceClient.voiceSettings.ingameName))
                                VoiceNames.Remove(voiceClient.voiceSettings.ingameName);
                        }

                        NAPI.ClientEvent.TriggerClientEventForAll("client:yaca:disconnect", remoteid);
                    };
                    await RunSafeFromAsyncContext(action);
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine(ex.ToString());
            }
        }

        [RemoteEvent("server:yaca:changeVoiceRange")]
        private void changeVoiceRange(Player sender, int range)
        {
            YacaVoiceClient voiceClient = sender.YacaVoiceClient();
            if (voiceClient == null) return;
            if (voiceClient.voiceSettings.voiceRange == 0) return;
            if (voiceClient.voiceSettings.maxVoiceRangeInMeter < range)
            {
                voiceClient.TriggerEvent("client:yaca:setMaxVoiceRange", 20);
            }
            voiceClient.voiceSettings.voiceRange = range;

            NAPI.ClientEvent.TriggerClientEventForAll("client:yaca:changeVoiceRange", sender.Id, voiceClient.voiceSettings.voiceRange);
            if (voiceClient.voicePlugin != null)
            {
                voiceClient.voicePlugin.range = range;
            }
            sender.SetSharedData("VOICE_RANGE", range);
            sender.SetData("VOICE_LAST_RANGE_PERMA", range);
        }

        [RemoteEvent("server:yaca:mutetToggle")]
        private void toggleMute(Player sender, bool state)
        {
            YacaVoiceClient voiceClient = sender.YacaVoiceClient();
            if (voiceClient == null) return;

            if (state)
            {
                voiceClient.voiceSettings.voiceRange = 0;
                if (voiceClient.voicePlugin != null)
                {
                    voiceClient.voicePlugin.range = 0;
                }
                sender.SetSharedData("VOICE_RANGE", voiceClient.voiceSettings.voiceRange);
            }
            else
            {
                int range = 3;
                if (sender.HasData("VOICE_LAST_RANGE_PERMA"))
                {
                    range = sender.GetData<int>("VOICE_LAST_RANGE_PERMA") == 0 ? 3 : sender.GetData<int>("VOICE_LAST_RANGE_PERMA");
                }
                voiceClient.voiceSettings.voiceRange = range;
                if (voiceClient.voicePlugin != null)
                {
                    voiceClient.voicePlugin.range = range;
                }
                sender.SetSharedData("VOICE_RANGE", range);
                NAPI.ClientEvent.TriggerClientEventForAll("client:yaca:changeVoiceRange", sender.Id, voiceClient.voiceSettings.voiceRange);
            }
        }

        [RemoteEvent("server:yaca:lipsync")]
        private void YacaPlayerLipSync(Player sender, bool state)
        {
            sender.SetSharedData("yaca:lipsync", state);
        }

        [RemoteEvent("server:yaca:addPlayer")]
        private void YacaAddPlayer(Player sender, string TeamspeakClientId)
        {
            YacaVoiceClient voiceClient = sender?.YacaVoiceClient();
            if (voiceClient == null) return;

            voiceClient.voiceSettings.voiceFirstConnect = true;
            sender.SetData("VOICE_ID", TeamspeakClientId);

            voiceClient.voicePlugin = new voicePlugin();
            voiceClient.voicePlugin.clientId = TeamspeakClientId;
            voiceClient.voicePlugin.forceMuted = voiceClient.voiceSettings.forceMuted;
            voiceClient.voicePlugin.range = voiceClient.voiceSettings.voiceRange;
            voiceClient.voicePlugin.playerId = sender.Id; // remoteId on Client
            voiceClient.voicePlugin.mutedOnPhone = voiceClient.voiceSettings.mutedOnPhone;

            NAPI.ClientEvent.TriggerClientEventForAll("client:yaca:addPlayers", JsonConvert.SerializeObject(voiceClient.voicePlugin));

            var allPlayersLoggenIn = NAPI.Pools.GetAllPlayers().ToList().Where(x => x.IsLoggedIn()).ToList();
            var allPlayersData = new List<voicePlugin>();
            foreach (var player in allPlayersLoggenIn)
            {
                YacaVoiceClient _voiceClient;
                if (this._voiceClients.TryGetValue(player, out _voiceClient))
                {
                    if (_voiceClient.voicePlugin != null && player.Id != sender.Id)
                    {
                        allPlayersData.Add(_voiceClient.voicePlugin);
                    }
                }
            }
            if (allPlayersData.Count > 100)
            {
                var splitlist = allPlayersData.ChunkBy(100);
                foreach (var list in splitlist)
                {
                    sender.TriggerEvent("client:yaca:addPlayers", JsonConvert.SerializeObject(list.ToArray()));
                }
            }
            else
            {
                sender.TriggerEvent("client:yaca:addPlayers", JsonConvert.SerializeObject(allPlayersData.ToArray()));
            }
        }

        public static void changePlayerAliveStatus(Player sender, bool alive)
        {
            YacaVoiceClient voiceClient = sender?.YacaVoiceClient();
            if (voiceClient == null) return;

            voiceClient.voiceSettings.forceMuted = !alive;
            NAPI.ClientEvent.TriggerClientEventForAll("client:yaca:muteTarget", sender.Id, !alive);

            if (voiceClient.voicePlugin != null) voiceClient.voicePlugin.forceMuted = !alive;
        }

        [RemoteEvent("server:yaca:useMegaphone")]
        private void playerUseMegaphone(Player sender, bool state)
        {
            // ToDo: Faction Binding
            if (sender.Vehicle == null) return;

            if (sender.VehicleSeat != 0 && sender.VehicleSeat != 1) return;
            changeMegaPhoneState(sender, state);
        }

        private void changeMegaPhoneState(Player sender, bool state, bool forced = false)
        {
            if (!state && (sender.GetSharedData<dynamic>("yaca:megaphoneactive") != null))
            {
                sender.ResetSharedData("yaca:megaphoneactive");
                if (forced) sender.SetData("lastMegaphoneState", false);
            }
            else if (state && (sender.GetSharedData<dynamic>("yaca:megaphoneactive") == null))
            {
                sender.SetSharedData("yaca:megaphoneactive", 30);
            }
        }
        private static readonly List<ulong> AllreadyAnnouceNoVoice = new List<ulong>();
        [RemoteEvent("server:yaca:noVoicePlugin")]
        private void playerNoYacyVoicePlugin(Player sender)
        {
            sender.NoteOverMap("~r~Dein YACA Voiceplugin ist nicht aktiviert!");
            NAPI.Task.Run(() =>
            {
                sender.Kick();
            }, 5000);
        }

        [RemoteEvent("server:yaca:wsReady")]
        private void playerReconnect(Player sender, bool isFirstConnect)
        {
            if (!sender.IsLoggedIn()) return;
            YacaVoiceClient voiceClient = sender.YacaVoiceClient();
            if (voiceClient == null)
            {
                sender.NoteOverMap("Hat nicht geklappt, bitte Game neu Starten!");
                return;
            }

            if (!voiceClient.voiceSettings.voiceFirstConnect) return;

            if (!isFirstConnect)
            {
                var name = sender.setVoiceName();
                if (name == null) return;
                if (VoiceNames.Contains(voiceClient.voiceSettings.ingameName))
                    VoiceNames.Remove(voiceClient.voiceSettings.ingameName);
                voiceClient.voiceSettings.ingameName = name;
            }
            sender.NoteOverMap("~g~Try Reconnect to Voice");
            ConnectToVoice(sender);
        }


        [ServerEvent(Event.PlayerExitVehicle)]
        private void ExitVehicle(Player sender, Vehicle vehicle)
        {
            changeMegaPhoneState(sender, false, true);
        }

        #endregion

        #region Funk / Radio

        [RemoteEvent("server:yaca:enableRadio")]
        public void enableRadio(Player sender, bool state)
        {
            YacaVoiceClient voiceClient = sender?.YacaVoiceClient();
            if (voiceClient == null) return;
            voiceClient.radioSettings.activated = state;
            voiceClient.radioSettings.hasLong = true;
            voiceClient.TriggerEvent("client:yaca:enableRadio", state);
        }

        [RemoteEvent("server:yaca:changeRadioFrequency")]
        public void changeRadioFrequency(Player sender, int Channel, string Frequenz)
        {
            YacaVoiceClient voiceClient = sender?.YacaVoiceClient();
            if (voiceClient == null) return;

            if (!voiceClient.radioSettings.activated)
            {
                return;
            }

            if (Channel < 1 || Channel > this.maxRadioChannels)
            {
                sender.SendErrorMessage("Fehlerhafter Funk Kanal");
                return;
            }

            if (Frequenz == "0")
            {
                leaveRadioFrequency(sender, Channel, Frequenz);
                return;
            }
            if (voiceClient.radioSettings.frequencies.ContainsKey(Channel))
            {
                if (voiceClient.radioSettings.frequencies[Channel] != Frequenz)
                {
                    leaveRadioFrequency(sender, Channel, voiceClient.radioSettings.frequencies[Channel]);
                }
            }

            if (this.RadioChannels.FirstOrDefault(x => x.channelName == Frequenz) == null)
                this._radioChannels.Add(new YacaRadioChannel { channelName = Frequenz });
            var RadioChan = this.RadioChannels.FirstOrDefault(x => x.channelName == Frequenz);
            if (!RadioChan.IsMember(voiceClient))
                this.RadioChannels.FirstOrDefault(x => x.channelName == Frequenz).AddMember(voiceClient, new RadioMemberInfo { muted = false });

            voiceClient.radioSettings.frequencies[Channel] = Frequenz;
            voiceClient.TriggerEvent("client:yaca:setRadioFreq", Channel, Frequenz);
        }

        public void leaveRadioFrequency(Player sender, int Channel, string Frequenz)
        {
            if (sender == null) return;
            try
            {
                if (!sender.IsLoggedIn()) return;
                YacaVoiceClient voiceClient = sender?.YacaVoiceClient();
                if (voiceClient == null) return;
                if (!voiceClient.radioSettings.frequencies.ContainsKey(Channel)) return;
                Frequenz = Frequenz == "0" ? voiceClient.radioSettings.frequencies[Channel] : Frequenz;

                if (this.RadioChannels.FirstOrDefault(x => x.channelName == Frequenz) == null) return;

                var allPlayersInChannel = this.RadioChannels.FirstOrDefault(x => x.channelName == Frequenz);

                List<Player> Players = new List<Player>();
                List<int> allTargets = new List<int>();
                var allPlayerOnline = NAPI.Pools.GetAllPlayers().ToList();
                foreach (var member in allPlayersInChannel.Members)
                {
                    Player target = allPlayerOnline.FirstOrDefault(x => x.Id == member.VoiceClient?.Player?.Id);
                    if (target != null)
                    {
                        Players.Add(target);
                    }
                    if (member.VoiceClient?.Player?.Id != sender.Id)
                    {
                        allTargets.Add(target.Id);
                    }
                }

                if (!this.USE_WHISPER && Players.Count > 0)
                {
                    if (voiceClient.voicePlugin != null)
                        NAPI.ClientEvent.TriggerClientEventToPlayers(Players.ToArray(), "client:yaca:leaveRadioChannel", voiceClient.voicePlugin.clientId, Frequenz);
                }
                if (this.USE_WHISPER)
                {
                    voiceClient.TriggerEvent("client:yaca:radioTalking", allTargets.ToArray(), Frequenz, false, null, true);
                }
                allPlayersInChannel.RemoveMember(voiceClient);
                if (allPlayersInChannel.Members.ToList().Count <= 0)
                {
                    this._radioChannels.Remove(allPlayersInChannel);
                }
            }
            catch { }
        }

        [RemoteEvent("server:yaca:muteRadioChannel")]
        private void radioChannelMute(Player sender, int channel)
        {
            YacaVoiceClient voiceClient = sender?.YacaVoiceClient();
            if (voiceClient == null) return;
            if (!voiceClient.radioSettings.frequencies.ContainsKey(channel)) return;
            var Frequenz = voiceClient.radioSettings.frequencies[channel];
            var foundPlayer = this.RadioChannels.FirstOrDefault(x => x.channelName == Frequenz).GetRadioMember(voiceClient);
            if (foundPlayer != null)
            {
                foundPlayer.memberInfo.muted = !foundPlayer.memberInfo.muted;
                voiceClient.TriggerEvent("client:yaca:setRadioMuteState", channel, foundPlayer.memberInfo.muted);
            }

        }

        [RemoteEvent("server:yaca:radioTalking")]
        private void radioTalkingState(Player sender, bool state)
        {
            if (sender == null) return;
            YacaVoiceClient voiceClient = sender?.YacaVoiceClient();
            if (voiceClient == null) return;

            if (!voiceClient.radioSettings.activated) return;
            if (!voiceClient.radioSettings.frequencies.ContainsKey(voiceClient.radioSettings.currentChannel)) return;
            string radioFrequency = voiceClient.radioSettings.frequencies[voiceClient.radioSettings.currentChannel];
            if (radioFrequency == "0") return;
            var playerID = sender.Id;

            var getPlayers = this.RadioChannels.FirstOrDefault(x => x.channelName == radioFrequency);

            List<Player> targets = new List<Player>();
            List<int> targetsToSender = new List<int>();
            Dictionary<int, RadioInfos> radioInfos = new Dictionary<int, RadioInfos>();
            var AllOnlinePlayers = NAPI.Pools.GetAllPlayers().ToList();

            foreach (var member in getPlayers.Members)
            {
                if (member.memberInfo.muted)
                {
                    if (member.VoiceClient?.Player?.Id == sender.Id)
                    {
                        targets = new List<Player>();
                        break;
                    }
                    continue;
                }

                if (member.VoiceClient?.Player?.Id == playerID) continue;
                var target = AllOnlinePlayers.FirstOrDefault(x => x.Id == member.VoiceClient?.Player?.Id);
                YacaVoiceClient targetVoiceClient = target?.YacaVoiceClient();
                if (targetVoiceClient == null) continue;
                if (targetVoiceClient != null)
                {
                    if (!targetVoiceClient.radioSettings.activated) continue;
                }

                var shortRange = !voiceClient.radioSettings.hasLong && !targetVoiceClient.radioSettings.hasLong;

                if ((voiceClient.radioSettings.hasLong && targetVoiceClient.radioSettings.hasLong) || shortRange)
                {
                    if (!targets.Contains(target))
                        targets.Add(target);
                    if (!radioInfos.ContainsKey(target.Id))
                        radioInfos.Add(target.Id, new RadioInfos { shortRange = shortRange });
                    if (!targetsToSender.Contains(target.Id))
                        targetsToSender.Add(target.Id);
                }
                if (targets.Count > 0)
                {
                    NAPI.ClientEvent.TriggerClientEventToPlayers(targets.ToArray(), "client:yaca:radioTalking", sender.Id, radioFrequency, state, radioInfos.ToArray());
                }
                if (this.USE_WHISPER)
                {
                    voiceClient.TriggerEvent("client:yaca:radioTalking", targetsToSender, radioFrequency, state, radioInfos.ToArray(), true);
                }
            }
            sender.SetSharedData("isTakingRadioNow", state);
            if (state)
            {
                // Animation Talk Radio here
            }
            else
            {
                // Animation Idle here or Stop Animation
            }
        }

        [RemoteEvent("yaca:synclips:server")]
        public void SyncLips(Player sender, bool state)
        {
            NAPI.ClientEvent.TriggerClientEventInRange(sender.Position, 50, "yaca:synclips", sender, state);
        }

        [RemoteEvent("server:yaca:changeActiveRadioChannel")]
        private void radioActiveChannelChange(Player sender, int Channel)
        {
            YacaVoiceClient voiceClient = sender?.YacaVoiceClient();
            if (voiceClient == null) return;

            if (Channel < 1 || Channel > this.maxRadioChannels) return;
            voiceClient.radioSettings.currentChannel = Channel;
        }

        [RemoteEvent("server:yaca:phoneSpeakerEmit")]
        private void phoneSpeakerEmit(Player sender, int[] enableForTargets, int[] disableForTargets)
        {
            List<Player> enableWhisperReceive = new List<Player>();
            List<Player> disableWhisperReceive = new List<Player>();
            YacaVoiceClient voiceClient = sender?.YacaVoiceClient();
            if (voiceClient == null) return;

            foreach (var callTarget in voiceClient.voiceSettings.inCallWith)
            {
                var target = NAPI.Pools.GetAllPlayers().ToList().FirstOrDefault(x => x.Id == callTarget);
                if (target != null)
                {
                    if (enableForTargets?.Length > 0) enableWhisperReceive.Add(target);
                    if (disableForTargets?.Length > 0) disableWhisperReceive.Add(target);
                }
            }

            if (enableWhisperReceive.Count > 0)
            {
                NAPI.ClientEvent.TriggerClientEventToPlayers(enableWhisperReceive.ToArray(), "client:yaca:playersToPhoneSpeakerEmit", enableForTargets, true);
            }
            if (disableWhisperReceive.Count > 0)
            {
                NAPI.ClientEvent.TriggerClientEventToPlayers(disableWhisperReceive.ToArray(), "client:yaca:playersToPhoneSpeakerEmit", disableForTargets, false);
            }
        }


        [RemoteEvent("server:yaca:newradiovolume")]
        private void radiVolumeChanged(Player sender, string Volume)
        {
            if (sender == null) return;
            sender.NoteOverMap("~b~Funklautstärke: ~g~" + Volume.ConvertToDouble());
            sender.SetRadioVolume(Volume.ConvertToDouble());
        }


        public static void radioVolumeUpDown(Player sender, bool higherorlower)
        {
            if (sender == null || !sender.IsLoggedIn()) return;
            sender.TriggerEvent("client:yaca:changeRadioChannelVolume", higherorlower);
        }
        public static void radioswitchSteroMode(Player sender)
        {
            if (sender == null || !sender.IsLoggedIn()) return;
            sender.TriggerEvent("client:yaca:changeRadioChannelStereo");
        }

        #endregion

        #region Phone
        public static readonly Dictionary<int, int> SpeakterDict = new Dictionary<int, int>();
        public static void CallPlayer(Player sender, Player target, bool state)
        {
            if (sender == null || target == null) return;
            target.TriggerEvent("client:yaca:phone", sender.Id, state);
            sender.TriggerEvent("client:yaca:phone", target.Id, state);
            if (SpeakterDict.ContainsKey(sender.Id))
            {
                SpeakterDict.Remove(sender.Id);
            }
            if (SpeakterDict.ContainsKey(target.Id))
            {
                SpeakterDict.Remove(target.Id);
            }
            if (!state)
            {
                muteOnPhone(sender, false, true);
                muteOnPhone(target, false, true);
            }
            else
            {
                SpeakterDict.Add(sender.Id, target.Id);
                SpeakterDict.Add(target.Id, sender.Id);
            }
        }
        public static void CallPlayerOldEffect(Player sender, Player target, bool state)
        {
            if (sender == null || target == null) return;
            target.TriggerEvent("client:yaca:phoneOld", sender.Id, state);
            sender.TriggerEvent("client:yaca:phoneOld", target.Id, state);
            if (SpeakterDict.ContainsKey(sender.Id))
            {
                SpeakterDict.Remove(sender.Id);
            }
            if (SpeakterDict.ContainsKey(target.Id))
            {
                SpeakterDict.Remove(target.Id);
            }

            if (!state)
            {
                muteOnPhone(sender, false, true);
                muteOnPhone(target, false, true);
            }
            else
            {
                SpeakterDict.Add(sender.Id, target.Id);
                SpeakterDict.Add(target.Id, sender.Id);
            }
        }

        [RemoteEvent("toggleMute")]
        private static void muteOnPhone(Player sender, bool state, bool onCallStop = false)
        {
            YacaVoiceClient voiceClient = sender?.YacaVoiceClient();
            if (voiceClient == null) return;

            if (onCallStop)
            {
                sender.ResetSharedData("yaca:phoneSpeaker");
            }
            voiceClient.voiceSettings.mutedOnPhone = state;
            NAPI.ClientEvent.TriggerClientEventForAll("client:yaca:phoneMute", sender.Id, state, onCallStop);
        }

        [RemoteEvent("toggleSpeaker")]
        private static void enablePhoneSpeaker(Player sender, bool state)
        {
            if (sender == null) return;

            if (state)
            {
                if (SpeakterDict.ContainsKey(sender.Id))
                {
                    List<int> phoneNumbers = new List<int> { sender.Id, SpeakterDict[sender.Id] };
                    sender.SetSharedData("yaca:phoneSpeaker", JsonConvert.SerializeObject(phoneNumbers));
                    sender.NoteOverMap("~g~Set Phone Speaker " + sender.Id + " > " + SpeakterDict[sender.Id]);
                }
            }
            else
            {
                sender.NoteOverMap("~r~Reset Phone Speaker");
                sender.ResetSharedData("yaca:phoneSpeaker");
            }
        }
        #endregion

        #region Helper
        public bool TryGetVoiceClient(Player client, out YacaVoiceClient voiceClient)
        {
            try
            {
                lock (_voiceClients)
                {
                    if (_voiceClients.TryGetValue(client, out voiceClient))
                        return true;
                }
                return false;
            }
            catch
            {
                voiceClient = null;
                return false;
            }
        }

        public static async Task RunSafeFromAsyncContext(Action action)
        {
            if (System.Threading.Thread.CurrentThread.ManagedThreadId == NAPI.MainThreadId)
            {
                action();
            }
            else
            {
                NAPI.Task.Run(action);
                await NAPI.Task.WaitForMainThread();
            }
        }

        #endregion
    }

    public static class YacaVoicePlayerExtenstion
    {
        public static YacaVoiceClient YacaVoiceClient(this Player client)
        {
            if (client == null) return null;
            try
            {
                if (YacaVoiceServer.Instance.VoiceClients.FirstOrDefault(x => x.Player == client) != null)
                    return YacaVoiceServer.Instance.VoiceClients.FirstOrDefault(x => x.Player == client);
                return null;
            }
            catch
            {
                return null;
            }
        }
        public static int GetNumbersInt(this string input)
        {
            try
            {
                int result;
                if (int.TryParse(input, out result))
                {
                    if (new string(input.Where(c => char.IsDigit(c)).ToArray()) == String.Empty)
                    {

                        return 0;
                    }
                    if (input.Contains("-"))
                    {
                        return Convert.ToInt32(input);
                    }
                    return Convert.ToInt32(new string(input.Where(c => char.IsDigit(c)).ToArray()));
                }
                return 0;
            }
            catch
            {
                return 0;
            }
        }
        public static double ConvertToDouble(this string betrag)
        {
            if (string.IsNullOrEmpty(betrag)) return 0;
            try
            {
                double _betrag = 0;
                if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
                {
                    _betrag = Convert.ToDouble(betrag.Replace(",", "."));
                }
                else
                {
                    _betrag = Convert.ToDouble(betrag.Replace(".", ","));
                }
                var resultC = Math.Round(_betrag, 2, MidpointRounding.AwayFromZero);
                return resultC;
            }
            catch
            {
                return 0;
            }
        }
        private static Random random = new Random();
        public static string RandomString(int length)
        {
            const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            return new string(Enumerable.Repeat(chars, length)
              .Select(s => s[random.Next(s.Length)]).ToArray());
        }
        public static void NoteOverMap(this Player Player, string text)
        {
            // Send Message to Client
        }
        public static void SendErrorMessage(this Player Player, string text, int time = 7500)
        {
            // Send Error Message to Client
        }
        public static void SetRadioVolume(this Player sender, double Volume)
        {
            if (sender == null) return;
            sender.SetSharedData("RadioVolume", Volume);
        }
        public static bool IsLoggedIn(this Player client)
        {
            if (client == null) return false;
            // here your Login Check
            return true;
        }
        public static string getVoiceName(this Player client)
        {
            if (client.HasData("VOICE_NAME"))
            {
                return client.GetData<dynamic>("VOICE_NAME");
            }
            return null;
        }

        public static string setVoiceName(this Player client)
        {
            if (client.HasData("VOICE_NAME"))
            {
                client.ResetData("VOICE_NAME");
            }
            string randomString;
            while (true)
            {
                randomString = RandomString(10).ToUpper();
                if (!YacaVoiceServer.VoiceNames.Contains(randomString))
                {
                    break;
                }
            }
            client.SetData("VOICE_NAME", randomString);
            return randomString;
        }
    }
    public static class ListHelper
    {
        public static List<List<T>> ChunkBy<T>(this List<T> source, int chunkSize)
        {
            return source
                .Select((x, i) => new { Index = i, Value = x })
                .GroupBy(x => x.Index / chunkSize)
                .Select(x => x.Select(v => v.Value).ToList())
                .ToList();
        }
    }
}
