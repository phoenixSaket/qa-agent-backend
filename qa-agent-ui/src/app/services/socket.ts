import { Injectable, signal } from '@angular/core';
import { Socket } from 'ngx-socket-io';

export interface ProjectState {
  type: string;
  running: boolean;
}

export interface LogMessage {
  type: string;
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class SocketService {
  agentMessages = signal<any[]>([]);
  uiDump = signal<string>('');
  screenshot = signal<string>('');
  agentThinking = signal<{chunk: string, step: number} | null>(null);
  fullPrompt = signal<{step: number, prompt: string, system: string | null} | null>(null);
  highlightTarget = signal<string | null>(null);

  frontendState = signal<ProjectState>({ type: 'frontend', running: false });
  backendState = signal<ProjectState>({ type: 'backend', running: false });
  logs = signal<LogMessage[]>([]);
  paths = signal<{frontend: string, backend: string}>({frontend: '', backend: ''});

  knowledgeData = signal<string>('');

  constructor(private socket: Socket) {
    this.setupListeners();
  }

  private setupListeners() {
    this.socket.on('agent_message', (data: any) => {
      this.agentMessages.update(msgs => [...msgs, data]);
    });

    this.socket.on('ui_dump', (data: {xml: string}) => {
      this.uiDump.set(data.xml);
    });

    this.socket.on('agent_screenshot', (data: {base64: string}) => {
      this.screenshot.set(data.base64);
    });

    this.socket.on('agent_thinking', (data: {chunk: string, step: number}) => {
      this.agentThinking.set(data);
    });

    this.socket.on('full_prompt', (data: {step: number, prompt: string, system: string | null}) => {
      this.fullPrompt.set(data);
    });

    this.socket.on('highlight_target', (data: {bounds: string}) => {
      this.highlightTarget.set(data.bounds);
    });

    this.socket.on('project_state', (data: ProjectState) => {
      if (data.type === 'frontend') this.frontendState.set(data);
      if (data.type === 'backend') this.backendState.set(data);
    });

    this.socket.on('project_log', (data: LogMessage) => {
      this.logs.update(logs => {
        const newLogs = [...logs, data];
        if (newLogs.length > 300) newLogs.shift();
        return newLogs;
      });
    });

    this.socket.on('paths_updated', (data: {frontend: string, backend: string}) => {
      this.paths.set(data);
    });

    this.socket.on('knowledge_data', (data: string) => {
      this.knowledgeData.set(data);
    });
  }

  // Emitters
  startProject(type: string) {
    this.socket.emit('start_project', type);
  }

  stopProject(type: string) {
    this.socket.emit('stop_project', type);
  }

  getProjectStates() {
    this.socket.emit('get_project_states');
  }

  toggleRecordingMode(isRecording: boolean) {
    this.socket.emit('toggle_recording_mode', isRecording);
  }

  startEmulatorStream() {
    this.socket.emit('start_emulator_stream');
  }

  stopEmulatorStream() {
    this.socket.emit('stop_emulator_stream');
  }

  userCommand(mission: string) {
    this.socket.emit('user_command', mission);
  }

  stopAgent() {
    this.socket.emit('stop_agent');
  }

  requestKnowledge() {
    this.socket.emit('request_knowledge');
  }

  browseDirectory(type: string) {
    this.socket.emit('browse_directory', type);
  }

  hitlResponse(confirmed: boolean) {
    this.socket.emit('hitl_response', confirmed);
  }
}
