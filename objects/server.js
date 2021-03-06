const generateName = require('../data/names'),
    Player = require('./player'),
    gameObjects = require('./games');

var s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);

class Server {
    constructor(io) {
        this.players = [];
        this.rooms = {};
        this.games = [
            {
                id: 'cah',
                name: 'Cards Against Humanity',
            },
            {
                id: 'jkh',
                name: 'Joking Hazard',
            },
            {
                id: 'ava',
                name: 'Avalon',
            },
            {
                id: 'lol',
                name: 'Love Letters',
            },
            {
                id: '31',
                name: 'Thirty-One',
            }
        ];
        this.gameKeys = this.games.map(g => g.id);
        this.roomRegex = new RegExp(`^(?:${this.gameKeys.join('|')})_[0-9a-e]{4}$`, 'i');

        this.io = io;
        this.io.on('connection', client => this.clientConnected(client));
    }

    clientConnected(client) {
        client.use((packet, next) => {
            if(packet[0] == 'game-event'){
                let game = this.findClientGame(client);
                if( game ){
                    return game.handleGameEvent(client.player, ...packet.slice(1));
                }
            }
            next();
        });

        client
            .on('send-chat', msg => this.handleChatMessage(client, msg))
            .on('choose-game', (playerName, gameId) => this.chooseGame(client, playerName, gameId))
            .on('create-game', () => this.createGame(client))
            .on('join-game', room => this.joinGame(client, room))
            .on('leave-game', () => this.leaveGame(client))
            .on('disconnect', () => this.disconnect(client));

        this.sendDirectMessage(client, 'welcome', {
            games: this.games,
            suggested_name: generateName(),
        });
    }

    findClientGame(client) {
        if(typeof client.player === 'undefined' || typeof client.player.game === 'undefined' || typeof client.player.room === 'undefined'){
            return false;
        }

        let game = client.player.game.id;
        let room = client.player.room;

        return this.rooms[ game ][ room ];
    }

    handleChatMessage(client, msg) {
        let playersRooms = Object.keys(client.rooms);
        for(let room of playersRooms){
            if( this.roomRegex.test(room) ){
                this.sendRoomMessage(client, room, 'received-chat', msg, client.player.name);
            }
        }
    }

    chooseGame(client, playerName, gameId) {
        if(typeof client.player === 'undefined'){
            for(let player of this.players){
                if(player.id == client.id){
                    console.log('Player is already connected');
                    client.player = player;
                    break;
                }
    
                if(player.name == playerName){
                    console.log('A player is already using that name');
                    this.sendDirectMessage(client, 'join-failed', {message: 'That name is already in use', suggested_name: generateName()});
                    return;
                }
            }

            if( !client.player ){
                let player = new Player(client.id, playerName);
                client.player = player;
            }
        }

        let game = this.games.find(g => g.id === gameId);
        if( !game ){
            this.sendDirectMessage(client, 'join-failed', {message: 'No matching game found'});
            return;
        }

        client.player.game = game;

        this.sendDirectMessage(client, 'player-update', client.player);
        this.sendDirectMessage(client, 'chose-game');
    }

    createGame(client) {
        console.log(`${client.player.name} has created a game!`);
        let game = client.player.game.id;
        if(typeof this.rooms[ game ] === 'undefined'){
            this.rooms[ game ] = {};
        }

        let room = s4();
        while(typeof this.rooms[ game ][ room ] !== 'undefined'){
            room = s4();
        }

        let gameRoom = `${game}_${room}`;
        client.join(gameRoom);
        client.player.room = room;

        let gameObj = new gameObjects[ game ](this.io, gameRoom);
        gameObj.addPlayer(client.player);

        this.rooms[ game ][ room ] = gameObj;

        this.sendDirectMessage(client, 'player-update', client.player);
        this.sendDirectMessage(client, 'created-game');
    }

    joinGame(client, room) {
        let game = client.player.game.id;
        let gameRoom = `${game}_${room}`;
        console.log(`${client.player.name} would like to join room ${room} in game ${game}`);

        client.join(gameRoom);
        client.player.room = room;
        this.rooms[ game ][ room ].addPlayer(client.player);

        this.sendRoomMessage(client, gameRoom, 'player-joined', client.player);

        this.sendDirectMessage(client, 'player-update', client.player);
        this.sendDirectMessage(client, 'joined-game', this.rooms[ game ][ room ].players);
    }

    leaveGame(client) {
        if(typeof client.player === 'undefined'){
            return;
        }
        
        let game = client.player.game.id;
        let room = client.player.room;
        let gameRoom = `${game}_${room}`;

        if(typeof game === 'undefined' || typeof room === 'undefined'){
            return;
        }

        client.leave(gameRoom);
        this.rooms[ game ][ room ].removePlayer(client.player);
        if(this.rooms[ game ][ room ].playerCount < 1){
            delete this.rooms[ game ][ room ];
            if(this.rooms[ game ].length < 1){
                delete this.rooms[ game ];
            }
        }

        delete client.player.room;

        this.sendRoomMessage(client, gameRoom, 'player-left', client.player);
        
        this.sendDirectMessage(client, 'player-update', client.player);
        this.sendDirectMessage(client, 'chose-game');
    }

    disconnect(client) {
        console.log(`Player ${client.id} has left the game`);
        this.leaveGame(client);
        this.players = this.players.filter(p => p.id !== client.id);
    }

    sendDirectMessage(client, message, ...data) {
        client.emit(message, ...data);
    }

    sendRoomMessage(client, room, message, ...data) {
        client.to(room).emit(message, ...data);
    }
}

module.exports = Server;