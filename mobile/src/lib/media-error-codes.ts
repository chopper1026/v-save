export const IOS_PHOTOS_INCOMPATIBLE_ERROR_CODE = 'IOS_PHOTOS_INCOMPATIBLE_CODEC';

export const isIosPhotosIncompatibleError = (error: any): boolean => {
  return error?.code === IOS_PHOTOS_INCOMPATIBLE_ERROR_CODE;
};
