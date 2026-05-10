import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DevicePreviewComponent } from './components/device-preview/device-preview';
import { LogStreamComponent } from './components/log-stream/log-stream';
import { KnowledgeCenterComponent } from './components/knowledge-center/knowledge-center';
import { SocketService } from './services/socket';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, DevicePreviewComponent, LogStreamComponent, KnowledgeCenterComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent {
  missionInput = '';
  isRecording = false;

  constructor(public socketService: SocketService) {}

  sendCommand() {
    if (this.missionInput.trim()) {
      this.socketService.userCommand(this.missionInput.trim());
      this.missionInput = '';
    }
  }

  stopAgent() {
    this.socketService.stopAgent();
  }

  toggleRecording() {
    this.socketService.toggleRecordingMode(this.isRecording);
  }

  startStack() {
    this.socketService.startProject('frontend');
    this.socketService.startProject('backend');
  }
}
