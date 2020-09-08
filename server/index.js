const io = require("socket.io");
const log = require("npmlog");
const server = io.listen(3476);

Object.defineProperty(log, 'heading', {
	get: () => {
		var d = new Date();
		return d.getFullYear() + "/" + zeroIt(d.getMonth()) + "/" + zeroIt(d.getDate()) + " " + zeroIt(d.getHours()) + ":" + zeroIt(d.getMinutes()) + ":" + zeroIt(d.getSeconds())
	}
})
log.headingStyle = {
	bg: '',
	fg: 'white'
}

zeroIt = (x) => x.toString().padStart(2, '0');

log.info("SRV", "A szerver elindult!");

/* constants */

const state = {
	LOBBY: 0,
	START: 1,
	INGAME: 2
}

const loginError = {
	NAMEALREADYINUSE: "A választott név már használatban van!",
	REGEX: "A választott név nem engedélyezett karaktereket tartalmaz!",
	LEN: "A választott név túl hosszú vagy rövid!",
	ALREADYLOGGEDIN: "Ezzel a kapcsolattal már történt bejelentkezés!"
};

/* runtime */

var clients = {};
var usedNames = [];

/* server */

server.on("connection", function (socket) {
	var ip = socket.handshake.address;
	log.warn("CLIENT", "Uj csatlakozas innen: " + ip + " (" + socket.id + ")");

	socket.emit('initializeConnection');

	socket.on('login', function (name) {
		let response = {
			errorMsg: "",
			success: false,
			name: name
		};
		if (name.length > 16 || name.length < 3) // bad length
			response.errorMsg = loginError.LEN;
		else if (!/^[a-zA-Z0-9._ ]+$/.test(name)) // not allowed characters
			response.errorMsg = loginError.REGEX;
		else if (usedNames.indexOf(name) != -1) // used name
			response.errorMsg = loginError.NAMEALREADYINUSE;
		else
			response.success = true;

		socket.emit('loginResponse', response);

		if (response.success) {
			log.info("LOGIN", "Sikeres bejelentkezes! (" + name + ")");
			addClient(socket, name);
			broadcastClientList();
		} else {
			log.warn("LOGIN", "Sikertelen bejelentkezes: " + response.errorMsg);
		}
	});

	socket.on('disconnect', function () {
		delClient(socket);
		server.sockets.emit('deleteInvites', [socket.id]);
		broadcastClientList();
	});

	socket.on('invitePlayer', function (target) {
		newInvite(socket, target);
	});

	socket.on('acceptInvite', function (target) {
		acceptInvite(socket, target);
	});

	socket.on('declineInvite', function (target) {
		declineInvite(socket, target);
	});

	socket.on('shipPreview', function (coords) {
		socket.emit('shipPreviewResponse', shipPreview(socket, coords));
	});

	socket.on('placeShip', function (coord1, coord2) {
		placeShip(socket, coord1, coord2);
	});

	socket.on('shoot', function (coord) {
		shoot(socket, coord);
	});

	socket.on('leaveGame', function () {
		leaveGame(socket);
	});

	socket.on('changeBusy', function (busy) {
		changeBusy(socket, busy);
	});
});

/* functions */

function broadcastClientList() {
	Object.keys(clients).forEach(x => {
		sendClientList(clients[x].socket);
	});
}

function addClient(socket, name) {
	clients[socket.id] = {
		id: socket.id,
		name: name,
		socket: socket,
		state: state.LOBBY,
		busy: false,
		gameId: null
	};
	usedNames.push(name);
}

function delClient(socket) {
	if (!clients[socket.id]) return;
	if (clients[socket.id].gameId != null)
		leaveGame(socket);
	usedNames.splice(usedNames.indexOf(clients[socket.id].name), 1);
	delete clients[socket.id];
}

function sendClientList(socket) {
	let res = {};
	Object.keys(clients).forEach(x => {
		res[x] = {
			name: clients[x].name,
			state: clients[x].state,
			busy: clients[x].busy
		};
	});
	socket.emit("updateClientList", res);
}

function inviteCheck(sender, target) {
	if (!clients.hasOwnProperty(target)) return log.error("INVITE-FAIL", "clients[] has no " + target + " entry (target)");
	if (!clients.hasOwnProperty(sender.id)) return log.error("INVITE-FAIL", "clients[] has no " + sender.id + " entry (sender)");
	sender = clients[sender.id];
	target = clients[target];
	if (target.busy || target.state != state.LOBBY || sender.state != state.LOBBY) return log.error("INVITE-FAIL", "Kuldo vagy fogado nincs a lobbyban");
	return {
		sender,
		target
	};
}

function newInvite(_sender, _target) {
	let parsed = inviteCheck(_sender, _target);
	if (typeof parsed != "object") return;
	let {
		sender,
		target
	} = parsed;
	sender.socket.emit("inviteSent", target.name, target.id);
	target.socket.emit("receiveInvite", sender.name, sender.id);
	log.info("INVITE", `${sender.name} meghivot kuldott ${target.name} jatekosnak!`);
}

function acceptInvite(_sender, _target) {
	log.info("INVITE", "Invite accept request from " + _sender.id);
	let parsed = inviteCheck(_sender, _target);
	if (typeof parsed != "object") return;
	let {
		sender,
		target
	} = parsed;
	sender.state = state.START;
	target.state = state.START;

	let gameId = Math.random().toString(36);
	sender.gameId = gameId;
	target.gameId = gameId;

	sender.socket.emit("inviteAccepted", target.id);
	target.socket.emit("inviteAccepted", sender.id);

	createGame(gameId, sender.id, target.id);

	server.sockets.emit('deleteInvites', [sender.id, target.id]);

	sender.socket.emit('message', {
		type: "PLACE-SHIPS",
		extra: 5
	});
	target.socket.emit('message', {
		type: "PLACE-SHIPS",
		extra: 5
	});

	log.info("INVITE", `${sender.name} elfogadta ${target.name} meghivasat`);
}

function declineInvite(_sender, _target) {
	log.info("INVITE", "Invite decline request from " + _sender.id);
	let parsed = inviteCheck(_sender, _target);
	if (typeof parsed != "object") return;
	let { sender, target } = parsed;
	sender.socket.emit("inviteDeclined", target.id);
	target.socket.emit("inviteDeclined", sender.id);
	log.info("INVITE", `${sender.name} elutasitotta ${target.name} meghivasat`);
}

function changeBusy(socket, busy) {
	clients[socket.id].busy = busy;
	broadcastClientList();
}

/* GAME */

var games = {};

function createGame(id, player1, player2) {
	games[id] = {
		players: [player1, player2],
		currentPlayer: 0,
		blocks: [
			[], // "A2", "A3"
			[]
		],
		maps: [
			{}, // 3: {"A2", "A4", "A5"}
			{}
		],
		shots: [
			{}, // "A2": true, "A3": false (hit or miss)
			{}
		]
	};
}

function leaveGame(socket) {
	let gameId = clients[socket.id].gameId;
	let playerId = getIndexBySocketID(gameId, socket.id);
	if (playerId == -1) return log.error("LEAVEGAME", `Nem talalhato a ${socket.id} jatekos a ${gameId} jatekban`);

	clients[socket.id].state = state.LOBBY;
	games[gameId].players.splice(playerId, 1);
	broadcastClientList();

	if (games[gameId].players.length == 0) return;
	let enemy = games[gameId].players[0];

	log.info("LEAVEGAME", `${clients[socket.id].name} kilepett mikozben ${clients[enemy].name} jatekossal jatszott`);
	clients[enemy].socket.emit("enemyLeft");

}

function shipPreview(socket, coords) {
	var coordsArr = coordsToArray(coords);
	var check = [],
		valid = [];

	check.push(getBlocksByCoords(coordsArr, [coordsArr[0], coordsArr[1] + 4]));
	check.push(getBlocksByCoords(coordsArr, [coordsArr[0] + 4, coordsArr[1]]));
	check.push(getBlocksByCoords(coordsArr, [coordsArr[0], coordsArr[1] - 4]));
	check.push(getBlocksByCoords(coordsArr, [coordsArr[0] - 4, coordsArr[1]]));

	let shipBlocks = getPlayerShipBlocks(socket);
	if (shipBlocks === false) return log.error("SHIP-PREVIEW", "unable to `getPlayerShipBlocks`");

	if (canPlace(coords, shipBlocks)) {
		for (var i = 0; i < check.length; i++) {
			for (var o = 0; o < check[i].length; o++) {
				if (canPlace(check[i][o], shipBlocks)) valid.push(check[i][o]);
				else break;
			}
		}
	}
	return valid;
}

function placeShip(socket, coord1, coord2) {
	let gameId = clients[socket.id].gameId;
	let playerId = getIndexBySocketID(gameId, socket.id);
	if (playerId == -1) return log.error("PLACESHIP", `Nem talalhato a ${socket.id} jatekos a ${gameId} jatekban`);
	if (coord1[0] != coord1[0] && coord2[1] != coord2[1]) return log.error("PLACESHIP", "Nincsenek egy vonalban a koodinatak: " + coord1.join(', ') + " & " + coord2.join(', '));

	let blocksBetween = getBlocksByCoords(coord1, coord2);
	let shipLength = blocksBetween.length;
	if (shipLength > 5 || shipLength == 0) return log.warn("PLACESHIP", clients[socket.id].name + " megprobalt lerakni egy " + shipLength + " hosszusagu hajot");

	if (games[gameId].maps[playerId].hasOwnProperty(shipLength)) {
		socket.emit('placeShipResponse', {
			success: false
		});
		return;
	}

	games[gameId].maps[playerId][shipLength] = blocksBetween;
	games[gameId].blocks[playerId] = games[gameId].blocks[playerId].concat(blocksBetween);

	socket.emit('placeShipResponse', {
		success: true,
		blocks: blocksBetween
	});
	log.info("PLACESHIP", clients[socket.id].name + " lerakott egy " + shipLength + " hosszusagu hajot");

	tryStart(gameId);
}

function tryStart(gameId) {
	let shipCounts = [Object.keys(games[gameId].maps[0]).length, Object.keys(games[gameId].maps[1]).length];
	let start = shipCounts[0] + shipCounts[1] == 10;
	if (start) {
		for (let i in shipCounts) {
			let socketId = games[gameId].players[i];
			clients[socketId].socket.emit('message', {
				type: "START"
			});
			setTimeout(firstShooters, 1000, gameId);
		}
	} else {
		for (let i in shipCounts) {
			let socketId = games[gameId].players[i];
			if (shipCounts[i] != 5)
				clients[socketId].socket.emit('message', {
					type: "PLACE-SHIPS",
					extra: 5 - shipCounts[i]
				});
			else
				clients[socketId].socket.emit('message', {
					type: "WAITING"
				});
		}
	}
}

function firstShooters(gameId) {
	let next = Math.round(Math.random());
	let players = games[gameId].players;
	for (let i in players) {
		let socketId = games[gameId].players[i];
		games[gameId].currentPlayer = next;
		clients[socketId].socket.emit('message', {
			type: i == next ? "SHOOT" : "WAIT"
		});
	}
}

function shoot(socket, coord) {
	let gameId = clients[socket.id].gameId;
	let playerId = getIndexBySocketID(gameId, socket.id);
	if (playerId == -1) return log.error("SHOOT", `Nem talalhato a ${socket.id} jatekos a ${gameId} jatekban`);

	if (games[gameId].currentPlayer != playerId) return log.warn("SHOOT", `${clients[socket.id].name} koron kivul probalt loni`);

	let otherPlayer = playerId == 1 ? 0 : 1;
	let hit = games[gameId].blocks[otherPlayer].indexOf(coord) != -1;
	games[gameId].shots[otherPlayer][coord] = hit;

	let shooter = games[gameId].players[playerId],
		enemy = games[gameId].players[otherPlayer];

	clients[shooter].socket.emit("SHOT-ENEMY", coord, hit);
	clients[enemy].socket.emit("SHOT-OWN", coord, hit);

	sunkLen = sunkBoats(gameId, shooter, enemy, otherPlayer, coord);

	nextShoot(gameId, shooter, enemy, otherPlayer, sunkLen, hit);
}

function sunkBoats(gameId, shooter, enemy, otherPlayer, currentShot) { // TODO: a remainingShipBlocks property instead of this
	let shipShotCounts = {
		1: 0,
		2: 0,
		3: 0,
		4: 0,
		5: 0
	};
	Object.keys(games[gameId].shots[otherPlayer]).forEach(shot => { // every shot
		if (!games[gameId].shots[otherPlayer][shot]) return; // only hits will be counted
		Object.keys(games[gameId].maps[otherPlayer]).forEach(ship => { // every ship
			if (games[gameId].maps[otherPlayer][ship].indexOf(shot) != -1) // if the shot hit that ship
				shipShotCounts[ship]++; // we increment the hits of that ship
		});
	});

	let sunk = [];
	Object.keys(shipShotCounts).forEach(ship => {
		if (ship == shipShotCounts[ship])
			sunk.push(ship);
	});

	sunk.forEach(ship => {
		let shipBlocks = games[gameId].maps[otherPlayer][ship];
		if (shipBlocks.indexOf(currentShot) != -1) { // the current shot sank the ship
			clients[shooter].socket.emit('SHIP-SANK', {
				own: false,
				shipBlocks
			});
			clients[enemy].socket.emit('SHIP-SANK', {
				own: true,
				shipBlocks
			});
			log.info("GAME", `${clients[shooter].name} elsullyesztette ${clients[enemy].name} ${ship} meretu hajojat.`);
		}
	});

	return sunk.length;
}

function nextShoot(gameId, current, next, enemyId, sunkLen, hit) {
	if (sunkLen == 5) {
		clients[current].socket.emit('message', {
			type: "VICTORY",
			extra: clients[next].name
		});
		clients[next].socket.emit('message', {
			type: "DEFEAT",
			extra: clients[current].name
		});
	} else {
		if (!hit) {
			games[gameId].currentPlayer = enemyId;
			clients[current].socket.emit('message', {
				type: "WAIT"
			});
			clients[next].socket.emit('message', {
				type: "SHOOT"
			});
		} else {
			clients[next].socket.emit('message', {
				type: "WAIT"
			});
			clients[current].socket.emit('message', {
				type: "SHOOT"
			});
		}
	}
}

// *HELPERS* //

function getPlayerShipBlocks(socket) {
	let gameId = clients[socket.id].gameId;
	let playerId = getIndexBySocketID(gameId, socket.id);
	if (playerId == -1) return false;
	return games[gameId].blocks[playerId];
}

function getIndexBySocketID(gameId, socketId) {
	return games[gameId].players.indexOf(socketId);
}

var ABC = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

function numToABC(num) {
	return ABC[num];
}

function ABCToNum(abc) {
	return ABC.indexOf(abc);
}

function coordsToArray(coords) {
	return [ABCToNum(coords[0]), parseInt(coords.substr(1))];
}

function arrayToCoords(array) {
	return numToABC(array[0]) + array[1];
}

function canPlace(coord, blocks) {
	if (!coord || !blocks) return false;
	let coordArray = coordsToArray(coord);
	if (coordArray[1] < 1 || coordArray[1] < 1 || coordArray[0] > 10 || coordArray[0] > 10) return false;
	if (blocks.length == 0) return true;
	if (blocks.indexOf(coord) !== -1) return false; // in
	if (blocks.indexOf(arrayToCoords([coordArray[0], coordArray[1] + 1])) !== -1) return false; // top
	if (blocks.indexOf(arrayToCoords([coordArray[0], coordArray[1] - 1])) !== -1) return false; // bottom
	if (blocks.indexOf(arrayToCoords([coordArray[0] + 1, coordArray[1]])) !== -1) return false; // right
	if (blocks.indexOf(arrayToCoords([coordArray[0] - 1, coordArray[1] + 1])) !== -1) return false; // left
	if (blocks.indexOf(arrayToCoords([coordArray[0] - 1, coordArray[1] + 1])) !== -1) return false; // top-left
	if (blocks.indexOf(arrayToCoords([coordArray[0] + 1, coordArray[1] + 1])) !== -1) return false; // top-right
	if (blocks.indexOf(arrayToCoords([coordArray[0] - 1, coordArray[1] - 1])) !== -1) return false; // bottom-left
	if (blocks.indexOf(arrayToCoords([coordArray[0] + 1, coordArray[1] - 1])) !== -1) return false; // bottom-right
	return true;
}

function getBlocksByCoords(c1, c2) {
	if (!c1 || !c2) return [];
	var x1 = c1[0],
		y1 = c1[1],
		x2 = c2[0],
		y2 = c2[1],
		dir = 0; // dir:clockwise
	if (x1 == x2 && y1 == y2) return [arrayToCoords(c1)];
	var _dist = dist(x1, y1, x2, y2),
		dir = Math.atan2(y2 - y1, x2 - x1) / Math.PI,
		tomb = [];
	for (var i = 0; i <= _dist; i++) {
		switch (dir) {
			case 0.5: // up
				tomb.push(arrayToCoords([x1, y1 + i]));
				break;
			case 0: // right
				tomb.push(arrayToCoords([x1 + i, y1]));
				break;
			case -0.5: // left
				tomb.push(arrayToCoords([x1, y1 - i]));
				break;
			default: // bottom
				tomb.push(arrayToCoords([x1 - i, y1]));
				break;
		}
	}
	return tomb;
}

function diff(num1, num2) {
	if (num1 > num2) {
		return (num1 - num2);
	} else {
		return (num2 - num1);
	}
}

function dist(x1, y1, x2, y2) {
	var deltaX = diff(x1, x2);
	var deltaY = diff(y1, y2);
	var dist = Math.sqrt(Math.pow(deltaX, 2) + Math.pow(deltaY, 2));
	return (dist);
};