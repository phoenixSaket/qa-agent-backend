import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LogStream } from './log-stream';

describe('LogStream', () => {
  let component: LogStream;
  let fixture: ComponentFixture<LogStream>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LogStream],
    }).compileComponents();

    fixture = TestBed.createComponent(LogStream);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
