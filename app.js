(function(){	
	var express = require('express')
	, app = express()
	, server = require('http').createServer(app)
	, io = require('socket.io').listen(server)
	, path = require('path')
	, Cookies = require('cookies')
	, CookieSigner = require('cookie-signature')
	, mongoose = require('mongoose')
	, uriUtil = require('mongodb-uri')
    	, cookieSession = require('express-session');
	
	var env = process.env.NODE_ENV || 'development';
	//ensure heroku or what ever web service actually has the NODE_ENV attribute set..
	//otherwise will cause a mongo error due to not being able to find the db url.
	console.log('environment:', env);
	var mongourl = process.env.MONGOLAB_URI || 'mongodb://localhost/confessme';
	var port = process.env.PORT || 5000;
	
	(process.env.NODE_ENV === 'production' ? io.set('log level', 1) : io.set('log level', 2));
	
	server.listen(port);
	var __dirname = "";
	var cookieMaxAge = 8000;
	var sessionKey = process.env.SESSION_KEY || 'development';
	var messageHandler = new MessageHandler();
	
	// New call to compress content
	app.use(express.compress());
	app.use(express.cookieParser());
	app.use(cookieSession({secret: sessionKey, cookie: {httpOnly: false}}));
	app.use('/js', express.static(path.resolve('js')));
	app.use('/css', express.static(path.resolve('css')));
	app.use('/img', express.static(path.resolve('img')));
	
	app.get('/', function (req, res) {
		var indexPath = path.resolve('index.html');
		res.sendfile(indexPath);
		
		var session = req.session;
		console.log(req.session);
	});
	
	/*Mongo configurations*/
	console.log('before mongoose.connect');
	var mongooseUri = uriUtil.formatMongoose(mongourl);
	mongoose.connect(mongooseUri);
	
	/*Mongoose Schema and Models*/
	var MessageSchema = new mongoose.Schema({
		text: {type:String, required: true},
		sessionID: {type:String},
		messageType: {type:String},
		timestamp: {type:Number, required: true}
	});
	
	var MessageModel = mongoose.model('Message', MessageSchema);
	
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
		//the reason why we use cookie based session management is because
		//we don't have access to the req through websockets.  We can only pass back the session data that the client knows
		//and what the client knows is the cookie data.
		socket.on('init', function(data){
			if(data.signedSessionID)
			{
				console.log('init data', data);
				//need to unescape sessionID since it comes back as escaped...
				var unsignedSessionID;
				unsignedSessionID = Helper.cookieUnsigner(data.signedSessionID);
		        sessionToSocketMap[unsignedSessionID] = socket.id;
		        console.log(sessionToSocketMap);
			}
			messageHandler.getMessageStorePromise().addBack(function(err, messages){
				if(err) return console.error(err);
				socket.emit('responseInit', {unsignedSessionID: unsignedSessionID, messageStore: messages, messageLimit: messageHandler.getMessageLimit()});
			});
			
		});
		
		//when receiving new information from the client, post it back to all the other clients
		socket.on('submit', function (data) {
			console.log("submit hit", data);
			data.messageType = MESSAGE_TYPES.CONFESSION;
			messageHandler.addMessage(data);
			io.sockets.emit('newMessage', messageHandler.getLatestMessage());
		});
		
		//when receiving an absolve from the client, send a message to that specific socket that gets absolved
		socket.on('pardon', function(data){
			console.log('pardoned', data);
			if(sessionToSocketMap[data.sessionForgiven]){
				if(socketIDtoSocketObjMap[sessionToSocketMap[data.sessionForgiven]]){
					data.sessionForgiver = Helper.cookieUnsigner(data.sessionForgiver);
					data.messageType = MESSAGE_TYPES.PARDON;
                    console.log('pardoned, sending message', {sessionID: data.sessionForgiver, messageType: data.messageType, timestamp: Date.now()});
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
		var MESSAGE_LIMIT = 300;
		this.addMessage = function(messageData){
//			if(messageStore.length > 30){
//				messageStore = messageStore.slice(1);
//			}
			var timeNow = Date.now();
			messageData.timestamp = timeNow;
			
			messageStore.push(messageData);
			
			//the latest 30 messages will also be stored in the mongo database
			var newMessage = new MessageModel({
				text: messageData.text,
				sessionID: messageData.sessionID,
				messageType: messageData.messageType,
				timestamp: messageData.timestamp
			});
			console.log('newMessage created', newMessage);
			newMessage.save(function(err){
				console.log('save hit?');
				if(err){
					console.error(err);
					return;
				}
				console.log('message saved,', newMessage.text);
			});
			
			//if the count of messages is greater than the limit, remove the earliest messages
			MessageModel.count({}, function(err, messageCount){
				if(err) return console.error(err);
				console.log('message count:', messageCount);
				if(messageCount > MESSAGE_LIMIT){
					MessageModel.findOneAndRemove({},{sort: {timestamp:1}},function(err, oldestEntry){
						if(err) console.error(err);
						console.log('oldest entry removed');
					});
				}
			});
			

			
//			newMessage.count({}, function(err, messageCount){
//				if(err) return console.error(err);
//				if(messageCount > MESSAGE_LIMIT){
//					
//				}
//			});
			
//			if(Object.keys(messageStore).length >= MESSAGE_LIMIT){
//				//remove one, before adding another
//				delete messageStore[Object.keys(messageStore)[0]];
//			}
//			messageStore[timeNow] = messageData;
		}
		this.getLatestMessage = function(){
			return messageStore[messageStore.length - 1];
		}
		this.getMessageStorePromise = function(){
			var query = MessageModel.find({});
			return query.exec(function(err, messages){
				if(err) return console.error(err);
				//console.log('messages returned from db', messages);
				return messages;
			});
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
        //this function either takes an unescaped signed cookie that needs to be escaped and unsigned,
        //or it already takes an unsigned escaped cookie and returns just that.. maybe I need to split this method because its handling two completely opposite jobs.
		cookieUnsigner: function(signedEscapedSessionID){
			if(signedEscapedSessionID){
                //signed unes
				if(signedEscapedSessionID.length > 32)
					return CookieSigner.unsign(unescape(signedEscapedSessionID).slice(2), sessionKey);
				else
					return signedEscapedSessionID
			}
			return "";
		}
	}

	MESSAGE_TYPES = {CONFESSION: 'confession', PARDON: 'pardon', THANKS: 'thanks'};
}());
