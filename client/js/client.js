$(function(){
    
    var state = {
        LOBBY: 0,
        START: 1,
        INGAME: 2,
        END: 3
    }

    var lobby = {
        name: "",
        partner: "",
        state: state.LOBBY,
        busy: false
    };

    let game = {
        shipPreview: [], // X, Y
        shipPlace: [], // X, Y
        allowed: false,
        ready: false
    };

    var invites = [];

    var ABC = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

    /* DOM */
	$(window).on('resize', handleResize);
    
	$('.loginform').submit(function(e){
        e.preventDefault();
        let name = $('.username').val();
        socket.emit('login', name);
        $('.username').val('');
    });
    
    $(document).on('click', '.invbtn', function(){
        let target = $(this).attr('data-target');
        invitePlayer(target);
    });
    
    $(document).on('click', '.acceptInvite', inviteReact);
    $(document).on('click', '.declineInvite', inviteReact);

    $(document).on('mouseenter', '.box', boxHover);
    $(document).on('click', '.box', boxClick);
    $(document).on('click', '#backtolobby', backToLobby);
    $(document).on('click', '#changebusy', changeBusy);

    function handleResize() {
        $('body').css('background-size',$(document).width()+'px '+$(document).height()+'px');
        $('#page').css('height',$(document).height()*0.9+'px');
        if($('.box').length > 0) {
            $('.box').css('height', $('#page').height()/14+"px");
            $('.box').css('line-height', $('.box').height()+"px");
        }
    }

    function updateMessage(msg) {
        $("#message").html(msg);
    }

    /* SOCKET */
    var socket = io.connect('http://localhost:3476');

    function initializeConnection() {
        lobby.name = '';
		lobby.partner = '';
        lobby.state = state.LOBBY;
        
        $('.after-login').css('display','none');
        $('#login').css('display','block');
        
        $('.response').html('');
        $('#page #title').html('Torpedo');
        
        if ($('.invitebox').length > 0)
            $('.invitebox').each(function(){ $(this).remove(); });
        
        $('#own').html('');
        $('#enemy').html('');
        $('#maps').hide();
        $('#title').show();

        $('#connectioninfo').show();
        $('#gameinfo').hide();

        handleResize();
    }
    socket.on('initializeConnection', initializeConnection);
    
    function loginResponse(response) {
        if(!response.success) {
            $('.response').html(response.errorMsg);
            return;
        }

        $('#login').fadeToggle(400, function(){
            $('.after-login').fadeToggle(400);
        });
        
        lobby.name = response.name;
        $('#name').html(lobby.name);
        $('#page #title').html('Torpedo - Lobby');
    }
    socket.on("loginResponse", loginResponse);

    function changeBusy() {
        lobby.busy = !lobby.busy;
        socket.emit('changeBusy', lobby.busy);
        $('#changebusy').html(lobby.busy?"Bekapcsolás":"Kikapcsolás");
    }

    function updateClientList(clients) {
        $("#users").html('');
        Object.keys(clients).forEach(x => {
            let user = "<li>";
            user += `<img src="img/${clients[x].busy?"off":"on"}.png"> `;
            user += clients[x].name;
            if(!lobby.busy && clients[x].name != lobby.name && !clients[x].busy && clients[x].state == state.LOBBY)
                user += ` <button class="invbtn" data-target="${x}">Meghívás játékra</button>`;
            if(clients[x].state != state.LOBBY)
                user += " (játékban van)";
            user += "</li>";
            $('#users').append(user);
        });
    }
    socket.on("updateClientList", updateClientList);

    function deleteInvites(clients) {
        $("#invites").children().each((_, x)=> {
            let target = $(x).attr('data-target');
            if(!target) return;
            if(clients.indexOf(target) != -1) {
                $(x).remove();
                invites.splice(invites.indexOf(x), 1);
            }
        });
    }
    socket.on("deleteInvites", deleteInvites);

    function invitePlayer(target) {
        if(lobby.state != state.LOBBY) return;
        if(invites.indexOf(target) != -1) return alert("Vele már van egy függésben lévő meghívód!");
        socket.emit("invitePlayer", target);
    }

    function newInvite(name, id, isReceived) {
        invites.push(id);
        
        var invDOM = $('#invites .'+(isReceived?"received":"sent")+'.sample').clone();
        $(invDOM).find(isReceived?".invitedBy":".target").html(name);
        $(invDOM).removeClass('sample');
        $(invDOM).addClass("invitebox" + (isReceived?" incoming":""));
        $(invDOM).attr('data-target', id);
        $("#invites").append(invDOM);
        $(invDOM).toggle(300);
    }

    function receiveInvite(name, id) {
        newInvite(name, id, true);
    }
    socket.on("receiveInvite", receiveInvite);

    function inviteSent(name, id) {
        newInvite(name, id, false);
    }
    socket.on("inviteSent", inviteSent);

    function inviteReact() {
        let invitebox = $(this).parent();
        let target = $(invitebox).data('target');
        if(invites.indexOf(target) == -1) return alert('Sikertelen művelet!');
        $(invitebox).toggle(300);
        invites.splice(invites.indexOf(target),1);
        socket.emit(this.className, target); // btn.className = "acceptInvite" || "declineInvite"
    }


    /* GAME */

    function backToLobby() {
        if(!confirm("Biztos ki szeretnél lépni a játékból?")) return;
        socket.emit("leaveGame");
        lobby.state = state.LOBBY;
        game.ready = false;
        clearShipPreview();

        // show lobby
        $('#lobby').toggle(100);
        $('#gameinfo').toggle(100);
        $('#invites').show();

        $('#maps').html('');
        $('#maps').toggle(200);
        $('#title').toggle(200);
        $('#own').removeClass('disabled');
        $('#enemy').addClass('disabled');
    }

    function inviteAccepted(target) {
        invites = [];
        // remove invites
        $('#invites')[0].childNodes.forEach(function(x){
            if(!$(x).hasClass("sample")) $(x).remove();
        });
        $('#invites').hide();
        
        // hide lobby
        $('#lobby').toggle(100);
        $('#gameinfo').toggle(100);

        // generate map
        let html = "";
        for(let a = 0; a < 2; a++) {
            html += `<div class="map" id="${a==0?"own":"enemy"}">`;
            for (let i = 0; i < ABC.length+1; i++) {
                html += '<div class="row">'
                for (let j = 0; j < ABC.length+1; j++) {
                    var classes = "box";
                    if(j == 0 && i == 0) classes += " transparent";
                    else if(j == 0 || i == 0) classes += " label";

                    var text = "";
                    if(i == 0 && j > 0) text = ABC[j-1];
                    else if(j == 0 && i > 0) text = i;

                    var coords = "";
                    if(i > 0 && j > 0) coords = ` id="${numToABC(j-1)+i}"`;
                    html += `<div class="${classes}"${coords}>${text}</div>`;
                }
                html += '</div>';
            }
            html += '</div>';
        }
        $('#maps').html(html);
        $('#maps').toggle(200);
        $('#title').toggle(200);
        $('#own').removeClass('disabled');
        $('#enemy').addClass('disabled');
        handleResize();
        lobby.state = state.START;
    }
    socket.on('inviteAccepted', inviteAccepted);

    function inviteDeclined(target) {
        deleteInvites([target]);
    }
    socket.on('inviteDeclined', inviteDeclined);

    function boxClick() {
        let coords = $(this).attr('id');
        let own = $(this).parent().parent().attr('id') == "own";
        if(!coords) return;
        let coordArr = coordsToArray(coords);

        switch(lobby.state) {
            case state.START:
                if(!own) return;
                if(game.shipPreview.length > 0 && game.shipPlace.length > 0 && $(this).hasClass('shippreview')) {
                    socket.emit("placeShip", game.shipPreview, game.shipPlace);
                    clearShipPreview();
                } else if(!game.ready) {
                    game.shipPlace = coordArr;
                    game.shipPreview = coordArr;
                    socket.emit("shipPreview", coords);
                }
                break;
            case state.INGAME:
                if(game.allowed) {
                    if($(this).html().length > 0)
                        return alert('Ide már lőttél!');
                    socket.emit("shoot", coords);
                }
                break;
        }
    }

    function clearShipPreview() {
        game.shipPlace = [];
        game.shipPreview = [];
        $('.shippreview.hover').removeClass('hover');
        $('.shippreview').removeClass('shippreview');
    }

    function shipPreview(valid) {
        $('.shippreview').removeClass('shippreview');
        valid.forEach(x=>{$("#"+x).addClass("shippreview")});
    }
    socket.on('shipPreviewResponse', shipPreview);

    function enemyLeft() {
        lobby.state = state.END;
        clearShipPreview();
        updateMessage('Az ellenfeled kilépett a játékból. A játéknak vége, a kilépéshez kattints a gombra!');
        updateMapDisableStatus();
    }
    socket.on('enemyLeft', enemyLeft);

    function coordsToArray(coords) {
        return [ ABCToNum(coords[0]), parseInt(coords.substr(1)) ];
    }

    function arrayToCoords(array) {
        return numToABC(array[0])+array[1];
    }

    function boxHover() {
        let coord = $(this).attr('id');
        if(!coord) return;
        let coordArr = coordsToArray(coord);

        if(game.shipPreview.length != 0) {
            $('.shippreview.hover').removeClass("hover");
            game.shipPlace = [];
            
            if(coordArr[0] != game.shipPreview[0] && coordArr[1] != game.shipPreview[1]) return;
            let b = getBlocksByCoords(coordArr, game.shipPreview);
            if(b.length == 0) return;
            
            b.forEach(x => $('#'+x).addClass('hover'));
            game.shipPlace = coordArr;
        }
    }

    function placeShipResponse(r) {
        if(!r.success) {
            alert("Már raktál le ekkora hajót!");
            return;
        }
        if(!r.blocks) return console.warn('no blocks received from placeShipResponse');
        r.blocks.forEach(x => {
            $('#'+x).addClass('ship');
        })
    }
    socket.on('placeShipResponse', placeShipResponse);

    socket.on('message', function(msg){
        switch(msg.type) {
            case 'PLACE-SHIPS':
                updateMessage(`<b>Rakj le</b> hajókat! Kattints a saját pályádon (<b>kék</b>) az egyik koordinátára, majd válaszd ki a méretet!<br>Még ${msg.extra} hajót kell leraknod!`);
                break;
            case 'WAITING':
                updateMessage(`Készen állsz! Várd meg, míg az ellenfeled is lerakja a hajóit!`);
                $('#own').addClass('disabled');
                game.ready = true;
                break;
            case 'START':
                updateMessage(`A játék elkezdődött.`);
                lobby.state = state.INGAME;
                $('#enemy').removeClass('disabled');
                $('#own').addClass('disabled');
                break;
            case 'SHOOT':
                updateMessage('<b>Te jössz!</b> Kattints az ellenfél pályájára a lövéshez!');
                game.allowed = true;
                updateMapDisableStatus();
                break;
            case 'WAIT':
                updateMessage('<b>Az ellenfeled következik!</b> Várd meg, amíg lő egyet!');
                game.allowed = false;
                updateMapDisableStatus();
                break;
            case 'VICTORY':
                updateMessage(`<b>Győztél!</b> Ezzel a lövéseddel elsüllyesztetted ${msg.extra} összes hajóját!`);
                lobby.state = state.END;
                updateMapDisableStatus();
                break;
            case 'DEFEAT':
                updateMessage(`<b>Vesztettél!</b> ${msg.extra} elsüllyesztette az összes hajódat!`);
                lobby.state = state.END;
                updateMapDisableStatus();
                break;
        }
    });

    function updateMapDisableStatus() {
        $('.disabled').removeClass('disabled');
        if(game.allowed) {
            $('#own').addClass('disabled');
            $('#enemy').removeClass('disabled');
        } else {
            $('#own').addClass('disabled');
            $('#enemy').addClass('disabled');
        }
    }

    function newShot(coord, hit, own) {
        let block = `#${(own?"own":"enemy")} #${coord}`;
        $(block).html("X");
        if(hit) $(block).addClass("active")
    }
    socket.on('SHOT-ENEMY', function(coord, hit){ newShot(coord, hit, false); });
    socket.on('SHOT-OWN', function(coord, hit){ newShot(coord, hit, true); });

    function onShipSank(obj) {
        obj.shipBlocks.forEach(b => {
            let block = `#${(obj.own?"own":"enemy")} #${b}`;
            $(block).addClass("sank");
        });
    }
    socket.on('SHIP-SANK', onShipSank);
    
    
    function getBlocksByCoords(c1, c2) {
        if(!c1 || !c2) return [];
        var x1 = c1[0], y1 = c1[1], x2 = c2[0], y2 = c2[1], dir = 0; // dir:clockwise
        if(x1 == x2 && y1 == y2) return [arrayToCoords(c1)];
        var _dist = dist(x1,y1,x2,y2),
            dir = Math.atan2(y2 - y1, x2 - x1)/Math.PI,
            tomb = [];
        for(var i=0;i<=_dist;i++) {
            switch(dir) {
                case 0.5: // up
                    tomb.push(arrayToCoords([x1, y1+i]));
                    break;
                case 0: // right
                    tomb.push(arrayToCoords([x1+i, y1]));
                    break;
                case -0.5: // left
                    tomb.push(arrayToCoords([x1, y1-i]));
                    break;
                default: // down
                    tomb.push(arrayToCoords([x1-i, y1]));
                    break;
            }
        }
        return tomb;
    }
    
    function diff (num1, num2) {
      if (num1 > num2) {
        return (num1 - num2);
      } else {
        return (num2 - num1);
      }
    }
    
    function dist (x1, y1, x2, y2) {
      var deltaX = diff(x1, x2);
      var deltaY = diff(y1, y2);
      var dist = Math.sqrt(Math.pow(deltaX, 2) + Math.pow(deltaY, 2));
      return (dist);
    };
    
    function numToABC(num) { return ABC[num]; }
    function ABCToNum(abc) { return ABC.indexOf(abc); }


});