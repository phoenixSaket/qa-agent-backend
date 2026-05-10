import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { SocketIoModule, SocketIoConfig } from 'ngx-socket-io';
import { provideHttpClient } from '@angular/common/http';

const config: SocketIoConfig = { url: 'http://localhost:3001', options: {} };

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    importProvidersFrom(SocketIoModule.forRoot(config))
  ]
};
