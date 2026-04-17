import * as msal from '@azure/msal-node';
import config from './index.js';

const msalConfig = {
  auth: {
    clientId: config.azure.clientId,
    authority: `https://login.microsoftonline.com/${config.azure.tenantId}`,
    clientSecret: config.azure.clientSecret,
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message, containsPii) {
        if (!containsPii) {
          console.log(`[MSAL] ${message}`);
        }
      },
      piiLoggingEnabled: false,
      logLevel: msal.LogLevel.Warning,
    },
  },
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

export { cca };
