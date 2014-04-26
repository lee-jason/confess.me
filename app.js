(function(){	
	var express = require('express')
	, app = express()
	, server = require('http').createServer(app)
	, io = require('socket.io').listen(server)
	, path = require('path')
	, Cookies = require('cookies')
	, CookieSigner = require('cookie-signature');
	
	server.listen(5000);
	var __dirname = "";
	var cookieMaxAge = 8000;
	var sessionKey = 'S3ssi0nK3y';
	var messageHandler = new MessageHandler();
	
	// New call to compress content
	app.use(express.compress());
	app.use(express.cookieParser());
	app.use(express.session({secret: sessionKey, cookie: {httpOnly: false}}));
	app.use('/js', express.static(path.resolve('js')));
	app.use('/css', express.static(path.resolve('css')));
	app.use('/img', express.static(path.resolve('img')));
	
	app.get('/', function (req, res) {
		var indexPath = path.resolve('index.html');
		res.sendfile(indexPath);
		
		var session = req.session;
	});
	
	//a map of sessionID to socket.id
	var sessionToSocketMap = [];
	//a map of socket.id to actual socket object
	var socketIDtoSocketObjMap = [];
	//when a user connects
	io.sockets.on('connection', function (socket) {
		socketIDtoSocketObjMap[socket.id] = socket;
		//send an updated user count to all clients during connections
		io.sockets.emit('newUserCount', {userCount: Object.size(socketIDtoSocketObjMap)});
	
		//on initial load, return the latest list of messages
		//when receiving sessionID information, store it in the list in memory
		//then pass back the unsigned version back to the client
		socket.on('init', function(data){
			if(data.signedSessionID)
			{
				//need to unescape sessionID since it comes back as escaped...
				var unsignedSessionID;
				unsignedSessionID = Helper.cookieUnsigner(data.signedSessionID);
		        sessionToSocketMap[unsignedSessionID] = socket.id;
		        console.log(sessionToSocketMap);
			}
			socket.emit('responseInit', {unsignedSessionID: unsignedSessionID, messageStore: messageHandler.getMessageStore(), messageLimit: messageHandler.getMessageLimit()});
		});
		
		//when receiving new information from the client, post it back to all the other clients
		socket.on('submit', function (data) {
			console.log(data);
			data.messageType = MESSAGE_TYPES.CONFESSION;
			messageHandler.addMessage(data);
			io.sockets.emit('newMessage', messageHandler.getLatestMessage());
		});
		
		//when receiving an absolve from the client, send a message to that specific socket that gets absolved
		socket.on('pardon', function(data){
			console.log(data);
			if(sessionToSocketMap[data.sessionForgiven]){
				if(socketIDtoSocketObjMap[sessionToSocketMap[data.sessionForgiven]]){
					data.sessionForgiver = Helper.cookieUnsigner(data.sessionForgiver);
					data.messageType = MESSAGE_TYPES.PARDON;
					socketIDtoSocketObjMap[sessionToSocketMap[data.sessionForgiven]].emit('newMessage', {sessionID: data.sessionForgiver, messageType: data.messageType, timestamp: Date.now()});
				}
			}
		});
		
		//when receiving a thankthepardoner, send a thank you message to the pardoner
		//no data needs to be sent, its the end of the communication chain.
		socket.on('thankthepardoner', function(data){
			if(sessionToSocketMap[data.sessionForgiver]){
				if(socketIDtoSocketObjMap[sessionToSocketMap[data.sessionForgiver]]){
					data.messageType = MESSAGE_TYPES.THANKS;
					socketIDtoSocketObjMap[sessionToSocketMap[data.sessionForgiver]].emit('newMessage', {messageType: data.messageType, timestamp: Date.now()});
				}
			}
		});
		
//		socket.on('requestLatestMessages', function(data){
//			socket.emit('responseLatestMessages', {'latestMessages': messageHandler.getMessagesAfterTimestamp(data.timestamp)});
//		});
		
		//we're checking if the socket that was generated for the user is disconnected so gotta put it inside the connection call
		socket.on('disconnect', function() { 
			if(socket.id){
				delete socketIDtoSocketObjMap[socket.id];
			}
			//send an updated user count to client during connections
			io.sockets.emit('newUserCount', {userCount: Object.size(socketIDtoSocketObjMap)});
		});
	});
	
	//class to keep track of the latest several messages as defined by the MESSAGE_LIMIT
	//Messages are stored by timestamp hash
	function MessageHandler(){
		//associative object where key value is the time stamp of when was created.
		//messageData will be updated appropriately to have this timestamp as well
		var messageStore = [];
		//the amount of messages exclusive
		var MESSAGE_LIMIT = 30;
		this.addMessage = function(messageData){
			if(messageStore.length > 30){
				messageStore = messageStore.slice(1);
			}
			var timeNow = Date.now();
			messageData.timestamp = timeNow;
			messageStore.push(messageData);
//			if(Object.keys(messageStore).length >= MESSAGE_LIMIT){
//				//remove one, before adding another
//				delete messageStore[Object.keys(messageStore)[0]];
//			}
//			messageStore[timeNow] = messageData;
		}
		this.getLatestMessage = function(){
			return messageStore[messageStore.length - 1];
		}
		this.getMessageStore = function(){
			return messageStore;
		}
		this.getMessageLimit = function(){
			return MESSAGE_LIMIT;
		}
		//returns only messages that are after the specified id.
		//this is so that multiple clients can request for their own specific new messages
		this.getMessagesAfterTimestamp = function(timestamp){
			var afterTimestampMessages = [];
			for(var i = 0; i < Object.keys(messageStore).length; i++){
				if(messageStore[Object.keys(messageStore)[i]].timestamp > timestamp){
					//By the way, there has to be a better way of getting the latest messages as requested by a timestamp
					//building a new array from the old object just seems really inefficient.  I bet there could
					//be tons of improvements made here.. Might be a choke point when lots of people request updates
					afterTimestampMessages.push(messageStore[messageStore[Object.keys(messageStore)[i]].timestamp]);
				}
			}
			return afterTimestampMessages;
		}
	}
	
	/*this .size method allows us to get the size of the associative object*/
	Object.size = function(obj) {
	    var size = 0, key;
	    for (key in obj) {
	        if (obj.hasOwnProperty(key)) size++;
	    }
	    return size;
	};
	
	Helper = {
		cookieUnsigner: function(signedEscapedSessionID){
			if(signedEscapedSessionID.length > 24)
				return CookieSigner.unsign(unescape(signedEscapedSessionID).slice(2), sessionKey);
			else
				return signedEscapedSessionID
		}
	}
	
	MESSAGE_TYPES = {CONFESSION: 'confession', PARDON: 'pardon', THANKS: 'thanks'};
}());
