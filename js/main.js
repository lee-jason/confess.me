(function(){
	var socket = io.connect(location.origin);
	//stores the unsigned sessionID post load
	var sessionHandler = new SessionHandler();
	var messageHandler = new MessageHandler();
	var displayHandler = new DisplayHandler();
	var MESSAGE_LIMIT = 10;
	//on document ready, submit the session cookie to the server for record keeping
	$(document).ready(function(){
		init();
	})
	
	function init(){
		displayHandler.recalculateLayout();
		//automatically update server with user's sessionID so we have a binding between browser session to Socket session
		//also requests for the latest saved messages to display
		socket.emit('init', {'signedSessionID': sessionHandler.getUserSessionID()});
		
		socket.on('responseInit', function(data){
			MESSAGE_LIMIT = data.messageLimit;
			sessionHandler.setUserSessionID(data.unsignedSessionID);
			messageHandler.addBulkMessage(data.messageStore);
			displayHandler.display(messageHandler.getMessageHistory());
		});
		
//		//receives latest messages
//		socket.on('responseLatestMessages', function(data){
//			messageHandler.addBulkMessage(data.messageStore);
//			displayHandler.display(messageHandler.getMessageHistory());
//		});
//		
//		//update sessionID with unsigned session which is used in main.js functions
//		//this is used when the server takes the encrypted sessionID and returns back the decryptedID.
//		//hopefully not a security concern.
//		socket.on('sessionUpdate', function(data){
//			sessionHandler.setUserSessionID(data.unsignedSessionID);
//		});
	
		//newMessages include confessions, pardons, and thank yous
		socket.on('newMessage', function(data) {
			data.text = html_sanitize(data.text);
			messageHandler.addMessage(data);
			displayHandler.displayOne(data);
		});
	
		//when receiving an updated userCount from server, update the user counter
		socket.on('newUserCount', function(data) {
			var submitMessage = 'submit';
			data.userCount > 0 ? submitMessage = 'tell '+data.userCount+' people' : 'leave a message';
			$('#submit').attr('value', submitMessage);
			
			//$('#userCount').html(data.userCount);
		});
	
		//when absolving a message, send the session of the forgiven and the forgiver
		$('body').on('click', '.messageContainer .message:not(".checked")', function(){
			if($(this).hasClass('confessionMessage')){
				socket.emit('pardon', {sessionForgiven: $(this).attr('data-session'), sessionForgiver: sessionHandler.getUserSessionID()});
			}
			else if($(this).hasClass('absolveMessage')){
				socket.emit('thankthepardoner', {sessionForgiver: $(this).attr('data-session')});
			}
			messageRead($(this));
		});
		
		//private function to..
		//2. add message id(timestamp?) to 'read' cookies
		//3. add the .checked class to the container element
		function messageRead($message){
			if(Object.keys(localStorage).length >= MESSAGE_LIMIT){
				//remove one, before adding another
				localStorage.removeItem(Object.keys(localStorage)[0]);
			}
			localStorage[$message.attr('data-timestamp')] = $message.attr('data-timestamp');
			$message.addClass('checked');
		}
		
		//binding form submission
		$('#confessionForm').on('submit', function(){
			submitForm();
			event.preventDefault();
		});
		
		//when window resizes redraw the layout of messages
		$(window).on('resize', function(){
			displayHandler.recalculateLayout();
		});
		
	    $("#submitBox").mousemove(function(e) {
	        var myPos = $(this).offset();
	        myPos.bottom = $(this).offset().top + $(this).outerHeight();
	        myPos.right = $(this).offset().left + $(this).outerWidth();
	        
	        if (myPos.bottom > e.pageY && e.pageY > myPos.bottom - 16 && myPos.right > e.pageX && e.pageX > myPos.right - 16) {
	            $(this).css({ cursor: "nw-resize" });
	        }
	        else {
	            $(this).css({ cursor: "" });
	        }
	    })
	    //  the following simple make the textbox "Auto-Expand" as it is typed in
	    .keyup(function(e) {
	        //  this if statement checks to see if backspace or delete was pressed, if so, it resets the height of the box so it can be resized properly
	        if (e.which == 8 || e.which == 46) {
	            $(this).height(parseFloat($(this).css("min-height")) != 0 ? parseFloat($(this).css("min-height")) : parseFloat($(this).css("font-size")));
	        }
	        //if enter, submit it
	        if(e.which === 13){
	        	$('#confessionForm').submit();
	        }
	        //  the following will help the text expand as typing takes place
	        while($(this).outerHeight() < this.scrollHeight + parseFloat($(this).css("borderTopWidth")) + parseFloat($(this).css("borderBottomWidth"))) {
	            $(this).height($(this).height()+1);
	        };
	    });
	}
	//when submitting data from client, post it back to server
	function submitForm(){
		var boxValue = html_sanitize($('#submitBox').val());
		var confessJSON = {text: boxValue, sessionID: sessionHandler.getUserSessionID()}
		socket.emit('submit', confessJSON);
		$('#submitBox').val('');
		$('#submitBox').height(parseFloat($('#submitBox').css("min-height")) != 0 ? parseFloat($('#submitBox').css("min-height")) : parseFloat($('#submitBox').css("font-size")));
	}
	
	//when receiving a message, either immediately prints or stores the message
	function receiveMessage(data){
		messageHandler.addMessage(data);
	}
	
	function SessionHandler(){
		var sessionID = getCookie('connect.sid') || "";
		this.getUserSessionID = function(){
			return sessionID;
		}
		this.setUserSessionID = function(sessID){
			sessionID = sessID;
		}
	}
	
	function MessageHandler(){
		//will hold on to the initial stored messages that we get from the server on first load
		var messageStore = [];
		//messages currently printed, messages will move to messageHistory queue after leaving messagesAwaiting
		var messageHistory = [];
	
		
		this.addMessage = function(data){
			messageHistory.push(data);
		}
		//takes in an array and adds it all to the message queue
		this.addBulkMessage = function(arr){
			for(var i = 0; i < arr.length; i++){
				messageHistory.push(arr[i]);
			}
		}
		this.getLatestMessage = function(){
			return messageHistory[messageHistory.length - 1];
		}
		this.getMessageHistory = function(){
			return messageHistory;
		}
		
//		//will find the timestamp of the latest message and requests for the messages after that specified time
//		this.requestLatestMessagesFromServer = function(){
//			var timestamp = 0;
//			if(messageHistory.length > 0){
//				timestamp = messageHistory[messageHistory.length - 1].timestamp;
//			}
//			socket.emit('requestLatestMessages', {'timestamp': timestamp});
//		}
	}
	
	function DisplayHandler(){
		var that = this;
		var colCount = 0;
		//final COL_WIDTH: 300px;
		var COL_WIDTH = 300;
		var COL_MARGINS = 20;
		var BROWSER_SCROLLBAR = 20;
		//array interpretation of the columns
		var colHeights = [];
		
		this.displayOne = function(data){
			//find the smallest column, add the new message to the top of that column
			var smallestColumn = 0;
			var smallestHeight = Number.MAX_VALUE;
			for(var i = 0; i < colCount; i++){
				if(colHeights[i] < smallestHeight){
					smallestHeight = colHeights[i];
					smallestColumn = i;
				}
			}
			var $colToAppend = $('.confessionCol:eq('+smallestColumn+')');
			
			$colToAppend.prepend(createMessageObj(data));
			colHeights[smallestColumn] = $('.confessionCol:eq('+smallestColumn+')').css('height').split('px')[0]*1;
		}
		
		this.display = function(messages){
			if(messages.length > 0){
				for(var i = 0; i < messages.length; i++){
					that.displayOne(messages[i]);
				}
			}
		}
		
		this.displayMultiple = function(arrayOfMessages){
			
		}
		
		function updateColCount(){
			colHeights = [];
			if(window.innerWidth >= 1300){
				colCount = 4;
			}
			else if(window.innerWidth >= 980){
				colCount = 3;
			}
			else if(window.innerWidth >= 660){
				colCount = 2;
			}
			else{
				colCount = 1;
			}
			//colCount = Math.floor(window.innerWidth / (COL_WIDTH + COL_MARGINS + BROWSER_SCROLLBAR));
			//instantiate the amount colHeights array with 0's
			for(var i = 0; i < colCount; i++){
				colHeights.push(0);
			}
		}
		
		//to only be called when the number of columns shifts
		function redrawAllMessages(messageQueue){
			$('.confessionCol').remove();
			for(var i = 0; i < colCount; i++){
				//TODO: why doesn't this work?  why does it not append?
				var newConfessCol = $('<div>', {'class': 'confessionCol'});
				$('#confessionContainer').append(newConfessCol);
			}
			that.display(messageQueue);
		}
		
		//called when the window resizes, detemrines whether an update to columns and a redraw is needed
		this.recalculateLayout = function(){
			var prevColCount = colCount;
			updateColCount();
			var currColCount = colCount;
			if(prevColCount != currColCount){
				redrawAllMessages(messageHandler.getMessageHistory());
			}
		}
		
		function createMessageObj(messageData){
			var $messageObj = $('<div/>', {'class': 'messageContainer'});
			switch(messageData.messageType){
				case MESSAGE_TYPES.CONFESSION:
					$messageObj.append($('<p/>', {'data-session': messageData.sessionID, 'data-timestamp': messageData.timestamp, 'class': 'confessionMessage message'}).html(messageData.text)); 
					break;
				case MESSAGE_TYPES.PARDON:
					$messageObj.append($('<p/>', {'data-session': messageData.sessionID, 'data-timestamp': messageData.timestamp, 'class': 'absolveMessage message'}).html("you've been forgiven for your actions"));
					break;
				case MESSAGE_TYPES.THANKS:
					$messageObj.append($('<p/>', {'class': 'thankyouMessage message'}).html("you have been thanked for your actions"));
					break;
				default:
					console.log("it really should never get here...");
			}
			if(localStorage[messageData.timestamp]){
				$messageObj.find('.message').addClass('checked');
			}
			var formattedTime = dateFormat(new Date(messageData.timestamp), 'mmmdd h:MMTT');
			$messageObj.append($('<p/>', {'class': 'timestamp'}).html('confessed ' + formattedTime));
			return $messageObj;
		}
	}
	
	
	
	//spits out either all or a limited amount of messages in the queue.
	function displayNewRoundOfMessages(){
		messageLimitTracker.messagesDisplayed = 0;
		while(messageQueue.length > 0 && messageLimitTracker.messagesDisplayed < messageLimitTracker.MESSAGES_TO_DISPLAY_PER_REFRESH)
		{
			displayContentFromMessageQueue(messageQueue.pop());
			messageLimitTracker.messagesDisplayed++;
		}
	}
	
	
	function getCookie(cname)
	{
	var name = cname + "=";
	//so document.cookie doesn't always work on localhost. returns ""
	var ca = document.cookie.split(';');
	for(var i=0; i<ca.length; i++) 
	  {
	  var c = ca[i].trim();
	  if (c.indexOf(name)==0) return c.substring(name.length,c.length);
	  }
	return "";
	}
	
	Helper = {
			getRandomInt: function(min, max) {
			  return Math.floor(Math.random() * (max - min + 1)) + min;
			}
	}
	
	MESSAGE_TYPES = {CONFESSION: 'confession', PARDON: 'pardon', THANKS: 'thanks'}
}());