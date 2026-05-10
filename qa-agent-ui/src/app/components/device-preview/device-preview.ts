import { Component, effect, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SocketService } from '../../services/socket';

@Component({
  selector: 'app-device-preview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './device-preview.html',
  styleUrls: ['./device-preview.css']
})
export class DevicePreviewComponent {
  xmlTree: any[] = [];
  deviceWidth = 1080;
  deviceHeight = 2400;

  @ViewChild('screenshotImg') screenshotImg!: ElementRef;

  constructor(public socketService: SocketService) {
    effect(() => {
      const xml = this.socketService.uiDump();
      if (xml) {
        this.parseXml(xml);
      }
    });

    effect(() => {
      const bounds = this.socketService.highlightTarget();
      if (bounds) {
        // Highlight logic can be added here based on bounds string
      }
    });
  }

  parseXml(xml: string) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');

    // Extract actual screen size from the root element
    const hierarchy = doc.querySelector('hierarchy');
    if (hierarchy) {
        const rootNode = hierarchy.firstElementChild;
        if (rootNode) {
            const rootBounds = rootNode.getAttribute('bounds');
            if (rootBounds) {
                const match = rootBounds.match(/\\[0,0\\]\\[(\\d+),(\\d+)\\]/);
                if (match) {
                    this.deviceWidth = parseInt(match[1], 10);
                    this.deviceHeight = parseInt(match[2], 10);
                }
            }
        }
    }

    const nodes = doc.querySelectorAll('node[bounds]');
    const newXmlTree: any[] = [];

    nodes.forEach(node => {
      const bounds = node.getAttribute('bounds');
      if (!bounds || bounds === '[0,0][0,0]') return;

      const classAttr = node.getAttribute('class') || '';
      const text = node.getAttribute('text') || '';
      const contentDesc = node.getAttribute('content-desc') || '';
      const clickable = node.getAttribute('clickable') === 'true';

      if (!clickable && !text && !contentDesc) return;

      const match = bounds.match(/\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]/);
      if (match) {
        const x1 = parseInt(match[1], 10);
        const y1 = parseInt(match[2], 10);
        const x2 = parseInt(match[3], 10);
        const y2 = parseInt(match[4], 10);

        const width = x2 - x1;
        const height = y2 - y1;

        newXmlTree.push({
          x: x1,
          y: y1,
          width,
          height,
          classAttr,
          text,
          contentDesc,
          bounds
        });
      }
    });
    this.xmlTree = newXmlTree;
  }
}
