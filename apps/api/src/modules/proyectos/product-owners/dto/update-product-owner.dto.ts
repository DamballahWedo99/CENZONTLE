import { PartialType } from '@nestjs/swagger';
import { CreateProductOwnerDto } from './create-product-owner.dto';

export class UpdateProductOwnerDto extends PartialType(CreateProductOwnerDto) {}
