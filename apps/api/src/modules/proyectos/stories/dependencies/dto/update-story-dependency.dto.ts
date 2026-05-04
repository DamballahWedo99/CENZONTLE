import { PartialType } from '@nestjs/swagger';
import { CreateStoryDependencyDto } from './create-story-dependency.dto';

export class UpdateStoryDependencyDto extends PartialType(CreateStoryDependencyDto) {}
