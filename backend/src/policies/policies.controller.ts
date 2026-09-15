import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { PoliciesService } from './policies.service';
import { CreatePolicyDto, UpdatePolicyDto } from './policies.dto';

@Controller('policies')
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  @Get()
  async findAll() {
    return this.policiesService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.policiesService.findById(id);
  }

  @Post()
  async create(@Body() createPolicyDto: CreatePolicyDto) {
    return this.policiesService.create(createPolicyDto);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updatePolicyDto: UpdatePolicyDto,
  ) {
    return this.policiesService.update(id, updatePolicyDto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.policiesService.delete(id);
  }
}
