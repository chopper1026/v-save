import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { BindPhoneDto } from './dto/bind-phone.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  private sanitizeUser(user: any) {
    const { password, ...result } = user;
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req) {
    const user = await this.usersService.findById(req.user.id);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return this.sanitizeUser(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  async updateProfile(
    @Request() req,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    const user = await this.usersService.updateProfile(
      req.user.id,
      updateProfileDto,
    );
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return this.sanitizeUser(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('account/password')
  async changePassword(
    @Request() req,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    const user = await this.usersService.changePassword(
      req.user.id,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
    );
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return {
      success: true,
      message: '密码修改成功',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('account/phone')
  async bindPhone(
    @Request() req,
    @Body() bindPhoneDto: BindPhoneDto,
  ) {
    const user = await this.usersService.bindPhone(req.user.id, bindPhoneDto.phone);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return this.sanitizeUser(user);
  }
}
