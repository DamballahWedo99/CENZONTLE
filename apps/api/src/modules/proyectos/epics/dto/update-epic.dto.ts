import { PartialType } from '@nestjs/swagger';
import { CreateEpicDto } from './create-epic.dto';

export class UpdateEpicDto extends PartialType(CreateEpicDto) {}
