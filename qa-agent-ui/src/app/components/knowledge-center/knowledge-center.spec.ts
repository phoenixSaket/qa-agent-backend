import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KnowledgeCenter } from './knowledge-center';

describe('KnowledgeCenter', () => {
  let component: KnowledgeCenter;
  let fixture: ComponentFixture<KnowledgeCenter>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KnowledgeCenter],
    }).compileComponents();

    fixture = TestBed.createComponent(KnowledgeCenter);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
