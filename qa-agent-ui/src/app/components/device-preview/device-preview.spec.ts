import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DevicePreview } from './device-preview';

describe('DevicePreview', () => {
  let component: DevicePreview;
  let fixture: ComponentFixture<DevicePreview>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DevicePreview],
    }).compileComponents();

    fixture = TestBed.createComponent(DevicePreview);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
