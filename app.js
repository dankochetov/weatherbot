'use strict';

const 
	bodyParser = require('body-parser'),
	crypto = require('crypto'),
	express = require('express'),
	https = require('https'),	
	request = require('request'),
	dateFormat = require('dateformat'),
	defer = require('./defer');

var app = express();
app.set('port', process.env.PORT || 3000);
app.set('view engine', 'ejs');
app.use(bodyParser.json());
app.use(express.static('public'));

const VALIDATION_TOKEN = process.env.MESSENGER_VALIDATION_TOKEN || '';

const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN || '';

const API_AI_ACCESS_TOKEN = process.env.API_AI_ACCESS_TOKEN || '';

const WEATHER_API_KEY = process.env.WEATHER_API_KEY || '';

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

app.post('/webhook', function (req, res) {
	var data = req.body;

	// Make sure this is a page subscription
	if (data.object == 'page') {
		// Iterate over each entry
		// There may be multiple if batched
		data.entry.forEach(function(pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

			// Iterate over each messaging event
			pageEntry.messaging.forEach(function(messagingEvent) {
			if (messagingEvent.message) {
				receivedMessage(messagingEvent);
			}
			else {
				console.log("Webhook received unknown messagingEvent: ", messagingEvent);
			}
			});
		});
		res.sendStatus(200);
	}
});

function receivedMessage(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;

	console.log("Received message for user %d and page %d at %d with message:", 
	senderID, recipientID, timeOfMessage);
	console.log(JSON.stringify(message));

	sendReadReceipt(senderID);
	sendTypingOn(senderID);

	(function(senderID) {
		request(
		{
			url: 'https://api.api.ai/v1/query',
			headers: {
				'Authorization': 'Bearer ' + API_AI_ACCESS_TOKEN,
				'Content-Type': 'application/json; charset=utf-8'
			},
			method: 'GET',
			qs: {
				v: '20150910',
				query: message.text,
				sessionId: '1234567890',
				lang: 'en'
			}
		}, function (error, response, body) {
			if (!error && response.statusCode == 200) {
				var queryParams = getQueryParams(JSON.parse(body));
				sendTextMessage(senderID, formResponseMessage(queryParams));
				if (!queryParams.fallback) {
					sendTypingOn(senderID);
					getForecast(queryParams).then(function(forecast) {
						console.log('promise');
						sendTextMessage(senderID, forecast);
					});
				}
			}
		});
	})(senderID);
}

function getQueryParams(body) {
	console.log(body.result.metadata.intentName);
	if (body.result.metadata.intentName != 'show weather')
		return {
			fallback: true,
			text: body.result.fulfillment.speech
		};

	var city = body.result.parameters.address.city;
	var state = body.result.parameters.address.state;
	var date = body.result.parameters.date;
	var time = body.result.parameters.time;
	var hasCity = city != null && city != "";
	var hasDate = date != null && date != "";
	var hasTime = time != null && time != "";
	var hasState = state != null && state != "";
	if (!hasCity) {
		if (hasState)
			city = state;
		else
			city = 'your location';
	}
	else if (hasState) {
		city += ', ' + state;
	}
	if (!hasDate)
		date = dateFormat(new Date(body.timestamp), 'isoDate');
	if (!hasTime) {
		if (hasDate)
			time = '00:00:00';
		else
			time = dateFormat(new Date(body.timestamp), 'isoTime');
	}

	return {
		fallback: false,
		time: time,
		hasTime: hasTime,
		date: date,
		hasDate: hasDate,
		city: city,
		hasCity: hasCity,
		state: state,
		hasState: hasState
	};
}

function formResponseMessage(params) {
	if (params.fallback)
		return params.text;
	var result = 'You requested a weather forecast in ' + params.city + ' for ' + params.date + ' at ' + params.time + '.';
	return result;
}

function getForecast(params) {
	var result = defer();

	if (!params.hasCity) {
		result.resolve('Cannot determine weather forecast in this location. Please specify the correct city name. Also, it may be that you specified the city I just don\'t know.');
		return result;
	}

	request(
	{
		url: 'http://api.openweathermap.org/data/2.5/forecast',
		qs: {
			q: params.city,
			APPID: WEATHER_API_KEY,
			units: 'metric'
		}
	}, function(err, response, body) {
		var allweather = JSON.parse(body);

		if (!allweather.list) {
			console.log(allweather);
			result.resolve('Cannot determine weather forecast in this location. Please try something else.');
			return result;
		}

		// Picking the closest forecast available from the list
		// The weather API gives me the forecast for 5 days maximum
		var closestForecastInd = 0;
		var closestForecastDt = 1e20;	
		var timeRequested = new Date(params.date + ' ' + params.time);
		for (var curForecastInd in allweather.list) {
			var curDt = Math.abs((new Date(allweather.list[curForecastInd].dt_txt)) - timeRequested);
			if (curDt < closestForecastDt) {
				closestForecastInd = curForecastInd;
				closestForecastDt = curDt;
			}
		}

		var weather = allweather.list[closestForecastInd];
		var weatherDate = new Date(allweather.list[closestForecastInd].dt_txt);

		var newLine = String.fromCharCode(10);

		var str = 'Showing closest weather available: ' + dateFormat(weatherDate, 'isoDate') + ' ' + dateFormat(weatherDate, 'isoTime') + newLine + newLine;
		str += 'Weather type: ' + weather.weather[0].description + newLine;
		str += 'Temperature: ' + weather.main.temp + ' °C' + newLine;
		str += 'Humidity: ' + weather.main.humidity + '%' + newLine;
		str += 'Wind speed: ' + weather.wind.speed + ' m/s' + newLine;
		str += 'Cloudiness: ' + weather.clouds.all + '%';
		result.resolve(str);
	});

	return result;
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
	var messageData = {
	recipient: {
		id: recipientId
	},
	message: {
		text: messageText,
		metadata: "DEVELOPER_DEFINED_METADATA"
	}
	};

	callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {
	console.log("Sending a read receipt to mark message as seen");

	var messageData = {
	recipient: {
		id: recipientId
	},
	sender_action: "mark_seen"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {
	console.log("Turning typing indicator on");

	var messageData = {
	recipient: {
		id: recipientId
	},
	sender_action: "typing_on"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {
	console.log("Turning typing indicator off");

	var messageData = {
	recipient: {
		id: recipientId
	},
	sender_action: "typing_off"
	};

	callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {
	console.log("Sending a read receipt to mark message as seen");

	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "mark_seen"
	};

	callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
	console.log(messageData);
	request(
	{
		uri: 'https://graph.facebook.com/v2.6/me/messages',
		qs: { access_token: PAGE_ACCESS_TOKEN },
		method: 'POST',
		json: messageData
	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {
			var recipientId = body.recipient_id;
			var messageId = body.message_id;

			if (messageId) {
			console.log("Successfully sent message with id %s to recipient %s", 
				messageId, recipientId);
			} else {
			console.log("Successfully called Send API for recipient %s", 
			recipientId);
			}
		} else {
			console.log(error || response.statusCode);
		}
	});
}

// Start server
app.listen(app.get('port'), function() {
	console.log('Node app is running on port', app.get('port'));
});

module.exports = app;