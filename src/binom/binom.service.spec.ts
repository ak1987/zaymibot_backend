import { Test, TestingModule } from '@nestjs/testing';
import { BinomService } from './binom.service';

describe('BinomService', () => {
  let service: BinomService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BinomService],
    }).compile();

    service = module.get<BinomService>(BinomService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
