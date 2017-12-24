// DiscIRC
// (C) 2017 antigravities
// https://www.gnu.org/licenses/gpl.html

// To authorize
// https://discordapp.com/oauth2/authorize?client_id=[client_id]&scope=bot&permissions=536879104

const fs = require("fs");

if( ! fs.existsSync("config.json") ){
  console.log("No configuration file found! Exiting...");
  process.exit(1);
}

var config = JSON.parse(fs.readFileSync("config.json"));

const irc = require("irc");
const Discord = require("discord.js");

const client = new Discord.Client();

var data = {};
data.servers = [];
data.nick = "DiscIRC";
data.hooks = {};
data.connections = {};
data.autojoin = {};

var connections = {};
var firstTime = true;
var guild = null;

var cachedClients = {};

String.prototype.replaceAll = function(find, replace) {
  return this.split(find).join(replace);
}

function sendDiscordMessage(server, chan, name, message){
  if( server == chan ) chan = "";
  fchan = server + chan;
  fchan = fchan.replaceAll(".", "-");
  fchan = fchan.replaceAll("#", "_");

  if( Object.keys(data.hooks).indexOf(fchan) < 0 ){
    guild.createChannel(fchan, "text").then((channel) => {
      channel.createWebhook("DiscIRC").then((hook) => {
        data.hooks[fchan] = {};
        data.hooks[fchan].id = hook.id;
        data.hooks[fchan].token = hook.token;

        data.connections[channel.id] = server + chan;

        fs.writeFileSync("data.json", JSON.stringify(data));

        sendToWebhook(data.hooks[fchan].id, data.hooks[fchan].token, name, message);
      });
    });
  }
  else {
    sendToWebhook(data.hooks[fchan].id, data.hooks[fchan].token, name, message);
  }
}

function sendToWebhook(webhookID, webhookToken, name, message){
  if( Object.keys(cachedClients).indexOf(webhookID) < 0 ){
    cachedClients[webhookID] = new Discord.WebhookClient(webhookID, webhookToken);
  }

  cachedClients[webhookID].send(message, {username: name, split: true});
}

function resolveChannel(message){
  if( Object.keys(data.connections).indexOf(message.channel.id) < 0 ){
    return 0;
  }

  var prot = data.connections[message.channel.id].split("#");

  if( Object.keys(connections).indexOf(prot[0]) < 0 ){
    return 1;
  }

  return prot;
}

function applyEvents(cxn, svn){
  cxn.on("motd", (motd) => {
    sendDiscordMessage(svn, svn, "MOTD for " + svn, motd);
  });

  cxn.on("join", (channel, nick) => {
    sendDiscordMessage(svn, channel, nick, "*has joined " + channel + "*");
  });

  cxn.on("part", (channel, nick, reason) => {
    sendDiscordMessage(svn, channel, nick, "*has parted " + channel + " - " + reason + "*");
  });

  cxn.on("message#", (nick, to, text) => {
    sendDiscordMessage(svn, to, nick, text);
  });

  cxn.on("nick", (old, newnick, chans) => {
    Object.keys(cxn.chans).forEach((v) => {
      if( chans.indexOf(v) > -1 ){
        sendDiscordMessage(svn, v, old, "*is now known as " + newnick + "*");
      }
    });
  });

  cxn.on("topic", (channel, topic, nick) => {
    Object.keys(data.connections).forEach((v) => {
      if( data.connections[v] == svn+channel ){
        guild.channels.get(v).setTopic(topic + " (set by " + nick + ")");
      }
    });
  });

  cxn.on("error", (err) => {
    //client.guilds.get(config.guild).defaultChannel.send(err.server + ": " + err.command + " " + err.args.join(", "));
    console.log(err);
  });

  return cxn;
}

client.on("ready", () => {
  guild = client.guilds.get(config.guild);

  if( fs.existsSync("data.json") ){
    data = JSON.parse(fs.readFileSync("data.json"));
  }

  data.servers.forEach((v) => {
    var chans = data.autojoin[v]||[];
    connections[v] = applyEvents(new irc.Client(v, data.nick, { channels: chans, realName: "DiscIRC", userName: "discirc" }), v);
  });

  client.on("message", (message) => {
    if( message.author.bot ) return;

    var m = message.content;

    if( m[0] == "/" ){
      var k = m.substring(1).split(" ");

      if( k[0] == "connect" ){
        data.servers.push(k[1]);
        fs.writeFileSync("data.json", JSON.stringify(data));
        connections[k[1]] = applyEvents(new irc.Client(k[1], data.nick, {userName: "discirc", realName: "DiscIRC"}), k[1]);
      }
      else if( k[0] == "join" ){
        if( data.servers.indexOf(message.channel.name) < 0 ){
          return message.reply("this command must be executed in a server channel");
        }

        if( Object.keys(data.autojoin).indexOf(message.channel.name) < 0 ){
          data.autojoin[message.channel.name] = [];
        }

        connections[message.channel.name].join(k[1], () => {
          data.autojoin[message.channel.name].push(k[1]);
          fs.writeFileSync("data.json", JSON.stringify(data));
        });
      }
      else if( k[0] == "inick" ){
        Object.keys(connections).forEach((v) => {
          connections[v].send("NICK", k[1]);
        });
        data.nick = k[1];
        fs.writeFileSync("data.json", JSON.stringify(data));
      }
      else if( k[0] == "part" ){
        var prot = resolveChannel(message);

        if( prot === 0 || prot === 1 ){
          return message.reply("no channel connection. are you connected to this server, and is this channel linked to an IRC channel?");
        }

        connections[prot[0]].part("#" + prot[1], "Leaving", () => {
          data.autojoin[prot[0]].splice(data.autojoin[prot[0]].indexOf("#" + prot[1]), 1);
          fs.writeFileSync("data.json", JSON.stringify(data));
        });
      } else if( k[0] == "disconnect" ){
        var rsn = message.channel.name.replaceAll("-", ".");

        if( data.servers.indexOf(rsn) < 0 ){
          return message.reply("this command must be executed in a server channel");
        }

        connections[rsn].disconnect("Quitting...", () => {
          message.reply("disconnected from " + rsn);
          data.servers.splice(data.servers.indexOf(rsn), 1);
          delete connections[rsn];
          fs.writeFileSync("data.json", JSON.stringify(data));
        });
      }
      else {
        message.reply("invalid command");
      }
      return;
    } else {
      var prot = resolveChannel(message);

      if( prot === 0 ){
        return message.reply("no channel connection, delete this channel and retry");
      }

      if( prot === 1 ){
        return message.reply("not connected to this server");
      }

      connections[prot[0]].say("#" + prot[1], m);
    }
  });
});

client.login(config.token);
