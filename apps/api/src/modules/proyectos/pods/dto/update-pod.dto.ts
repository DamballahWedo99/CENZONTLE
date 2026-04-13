import { PartialType } from '@nestjs/swagger';
import { CreatePodDto } from './create-pod.dto';

export class UpdatePodDto extends PartialType(CreatePodDto) {}
