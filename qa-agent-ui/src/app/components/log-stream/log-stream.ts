import { Component, computed, signal, ViewChild, ElementRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SocketService } from '../../services/socket';

@Component({
  selector: 'app-log-stream',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './log-stream.html',
  styleUrls: ['./log-stream.css']
})
export class LogStreamComponent {
  filterType = signal<'all' | 'frontend' | 'backend'>('all');

  filteredLogs = computed(() => {
    const logs = this.socketService.logs();
    const filter = this.filterType();
    if (filter === 'all') return logs;
    return logs.filter(log => log.type === filter);
  });

  @ViewChild('logContainer') logContainer!: ElementRef;

  constructor(public socketService: SocketService) {
    effect(() => {
        // Trigger auto scroll when logs change
        const logs = this.filteredLogs();
        setTimeout(() => this.scrollToBottom(), 50);
    });
  }

  setFilter(type: 'all' | 'frontend' | 'backend') {
    this.filterType.set(type);
  }

  scrollToBottom() {
      if (this.logContainer) {
          this.logContainer.nativeElement.scrollTop = this.logContainer.nativeElement.scrollHeight;
      }
  }

  isError(message: string): boolean {
      const lower = message.toLowerCase();
      return lower.includes('error') || lower.includes('exception');
  }
}
