import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { CancellationPolicy, CancellationPolicySchema } from './policies.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CancellationPolicy.name, schema: CancellationPolicySchema },
    ]),
  ],
  controllers: [PoliciesController],
  providers: [PoliciesService],
  exports: [PoliciesService, MongooseModule],
})
export class PoliciesModule {}
