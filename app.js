var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var request = require('request');

var routes = require('./routes/index');
var users = require('./routes/users');

const VALIDATION_TOKEN = process.env.VALIDATION_TOKEN || '';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));


// Facebook webhook verification
app.get('/webhook', function(req, res) {
	if (req.query['hub.mode'] === 'subscribe' &&
			req.query['hub.verify_token'] === VALIDATION_TOKEN) {
		console.log("Validating webhook");
		res.status(200).send(req.query['hub.challenge']);
	} else {
		console.error("Failed validation. Make sure the validation tokens match.");
		res.sendStatus(403);					
	}	
});

app.post('/webhook', function(req, res, next) {
	var data = req.body;
	if (data.object == 'page') {
		data.entry.forEach(function(pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.name;

			pageEntry.messaging.forEach(function(messagingEvent) {
				if (messagingEvent.message) {
					receivedMessage(messagingEvent);
				}
			});
		});
	}
	else {
		console.log('data is:');
		console.log(JSON.stringify(data));
	}
});

function sendMessage(recipientID, messageText) {
	var messageData = {
		recipient: {
			id: recipientID
		},
		message: {
			text: messageText
		}
	};

	request({
		uri: 'https://graph.facebook.com/v2.6/me/messages',
		qs: {
			access_token: PAGE_ACCESS_TOKEN
		},
		method: 'POST',
		json: messageData
	}, function(error, response, body) {
		if (!error && response.statusCode == 200) {
			var recipientID = body.recipient_id;
			var messageID = body.message_id;
			console.log("Successfully sent generic message with id %s to recipient %s", messageID, recipientID);
		}
		else {
			console.error("Unable to send message.");
			console.error(response);
			console.error(error);
		}
	});
}

function receivedMessage(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;
	console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
	console.log(JSON.stringify(message));

	var messageID = message.mid;

	var messageText = message.text;
	sendTextMessage(senderID, messageText);
}

// catch 404 and forward to error handler
app.use(function(req, res, next) {
	var err = new Error('Not Found');
	err.status = 404;
	next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
	app.use(function(err, req, res, next) {
		res.status(err.status || 500);
		res.render('error', {
			message: err.message,
			error: err
		});
	});
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
	res.status(err.status || 500);
	res.render('error', {
		message: err.message,
		error: {}
	});
});


module.exports = app;
