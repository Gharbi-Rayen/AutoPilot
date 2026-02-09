export const generateGoogleFormScript = (
  webhookUrl: string,
) => `function onFormSubmit(e) {
  var formResponse = e.response;
  var itemResponses = formResponse.getItemResponses();

  // Build responses object
  var responses = {};
  for (var i = 0; i < itemResponses.length; i++) {
    var itemResponse = itemResponses[i];
    responses[itemResponse.getItem().getTitle()] = itemResponse.getResponse();
  }

  // Prepare webhook payload
  var payload = {
    formId: e.source.getId(),
    formTitle: e.source.getTitle(),
    responseId: formResponse.getId(),
    timestamp: formResponse.getTimestamp(),
    respondentEmail: formResponse.getRespondentEmail(),
    responses: responses
  };

  // Send to webhook
  var options = {
    'method': 'post',
    'contentType': 'application/json',
    'headers': {
      'ngrok-skip-browser-warning': 'true'
    },
    'payload': JSON.stringify(payload)
  };

  var WEBHOOK_URL = '${webhookUrl}';

  try {
    var response = UrlFetchApp.fetch(WEBHOOK_URL, options);
    Logger.log('✓ Webhook success: ' + response.getContentText());
  } catch(error) {
    Logger.log('✗ Webhook failed: ' + error.toString());
    // You can view logs in Google Apps Script by clicking View > Logs
  }
}`;
