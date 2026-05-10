import { Component, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SocketService } from '../../services/socket';
import { marked } from 'marked';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-knowledge-center',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './knowledge-center.html',
  styleUrls: ['./knowledge-center.css']
})
export class KnowledgeCenterComponent {
  markdownHtml = signal<SafeHtml>('');

  constructor(public socketService: SocketService, private sanitizer: DomSanitizer) {
    effect(() => {
      const data = this.socketService.knowledgeData();
      if (data) {
        this.renderMarkdown(data);
      }
    });
  }

  requestRefresh() {
    this.socketService.requestKnowledge();
  }

  async renderMarkdown(data: string) {
      const parsed = await marked.parse(data);
      this.markdownHtml.set(this.sanitizer.bypassSecurityTrustHtml(parsed));
  }
}
